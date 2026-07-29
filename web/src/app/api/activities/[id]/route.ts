import { NextRequest } from "next/server";
import { z } from "zod";
import { db, activities, workouts, strengthSessions, deletedActivities, activityTrash } from "@/db";
import { eq } from "drizzle-orm";
import { getAccessToken } from "@/lib/sync/strava-client";
import { garminTombstoneKey } from "@/lib/sync/garmin-activity-import";
import { rowToPayload } from "@/lib/activity-trash";

const STRAVA_API = "https://www.strava.com/api/v3";

// ── Types for raw JSON stored in DB ─────────────────────────────────────────

interface RawSplit {
  split: number;
  distance: number;
  elapsed_time: number;
  moving_time: number;
  average_speed: number;
  average_heartrate?: number;
  elevation_difference?: number;
  pace_zone?: number;
}

interface RawLap {
  lap_index: number;
  distance: number;
  elapsed_time: number;
  moving_time: number;
  average_speed: number;
  average_heartrate?: number;
  max_heartrate?: number;
}

// Strava's streams endpoint returns an ARRAY of { type, data } objects (one
// per requested key), not an object keyed by type — a pre-existing parsing
// bug here (Object.entries on the array elements, which have no `.data`
// property under their `type`/`data` keys themselves) meant this always
// silently returned null and streams never rendered. Fixed alongside adding
// the cache, since caching a permanently-null value has no value.
interface StravaStreamEntry {
  type: "distance" | "heartrate" | "velocity_smooth" | "altitude" | "latlng" | "time";
  data: number[] | [number, number][];
}

interface StravaDetailedActivity {
  name?: string;
  best_efforts?: Array<{
    name: string;
    distance: number;
    elapsed_time: number;
    moving_time: number;
  }>;
  // Strava reports running cadence in strides/min (one leg) — ×2 for spm.
  average_cadence?: number;
  calories?: number;
  device_name?: string;
  gear?: { id: string; name: string };
  map?: { summary_polyline?: string };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseSplits(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return (raw as RawSplit[]).map((s) => ({
    km: s.split,
    paceSecKm:
      s.average_speed > 0 ? Math.round(1000 / s.average_speed) : 0,
    elevationDiff: s.elevation_difference ?? 0,
    ...(s.average_heartrate != null
      ? { avgHr: Math.round(s.average_heartrate) }
      : {}),
  }));
}

function parseLaps(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return (raw as RawLap[]).map((l) => ({
    index: l.lap_index,
    distanceKm: l.distance / 1000,
    durationSeconds: l.moving_time,
    paceSecKm:
      l.average_speed > 0 ? Math.round(1000 / l.average_speed) : 0,
    ...(l.average_heartrate != null
      ? { avgHr: Math.round(l.average_heartrate) }
      : {}),
    ...(l.max_heartrate != null
      ? { maxHr: Math.round(l.max_heartrate) }
      : {}),
  }));
}

// Shape stored in `activities.streams_json` and returned to the client —
// same fields fetchStravaStreams parses off the live Strava response.
interface ParsedStreams {
  distance: number[];
  time: number[];
  heartrate?: number[];
  velocity?: number[];
  altitude?: number[];
  latlng?: [number, number][];
}

async function fetchStravaStreams(
  stravaId: string,
  token: string
): Promise<ParsedStreams | null> {
  try {
    const res = await fetch(
      `${STRAVA_API}/activities/${stravaId}/streams?keys=heartrate,velocity_smooth,altitude,latlng,distance,time&resolution=medium`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return null;
    const data: StravaStreamEntry[] = await res.json();
    // Strava returns an array of { type, data } stream objects, keyed off
    // `type` here so the lookups below stay by name.
    const map: Record<string, unknown[]> = {};
    for (const stream of data) {
      if (stream?.type && stream?.data) map[stream.type] = stream.data;
    }
    const timeData = map["time"] as number[] | undefined;
    if (!timeData) return null;
    return {
      distance: (map["distance"] as number[]) ?? [],
      time: timeData,
      ...(map["heartrate"] ? { heartrate: map["heartrate"] as number[] } : {}),
      ...(map["velocity_smooth"]
        ? { velocity: map["velocity_smooth"] as number[] }
        : {}),
      ...(map["altitude"] ? { altitude: map["altitude"] as number[] } : {}),
      ...(map["latlng"]
        ? { latlng: map["latlng"] as [number, number][] }
        : {}),
    };
  } catch {
    return null;
  }
}

interface StravaLiveDetail {
  bestEfforts: Array<{
    name: string;
    distance: number;
    elapsedTime: number;
    movingTime: number;
  }>;
  polyline: string | null;
  cadenceSpm: number | null; // steps per minute (Strava value ×2)
  calories: number | null;
  deviceName: string | null;
  gearName: string | null;
}

const EMPTY_LIVE_DETAIL: StravaLiveDetail = {
  bestEfforts: [],
  polyline: null,
  cadenceSpm: null,
  calories: null,
  deviceName: null,
  gearName: null,
};

async function fetchStravaDetail(
  stravaId: string,
  token: string
): Promise<StravaLiveDetail> {
  try {
    const res = await fetch(`${STRAVA_API}/activities/${stravaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return EMPTY_LIVE_DETAIL;
    const data: StravaDetailedActivity = await res.json();
    return {
      bestEfforts: (data.best_efforts ?? []).map((e) => ({
        name: e.name,
        distance: e.distance,
        elapsedTime: e.elapsed_time,
        movingTime: e.moving_time,
      })),
      polyline: data.map?.summary_polyline || null,
      cadenceSpm:
        data.average_cadence != null && data.average_cadence > 0
          ? Math.round(data.average_cadence * 2)
          : null,
      calories: data.calories != null ? Math.round(data.calories) : null,
      deviceName: data.device_name ?? null,
      gearName: data.gear?.name ?? null,
    };
  } catch {
    return EMPTY_LIVE_DETAIL;
  }
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Fetch activity row
    const [activity] = await db
      .select()
      .from(activities)
      .where(eq(activities.id, id))
      .limit(1);

    if (!activity) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    // Everything Strava-sourced is cached on the row once synced (see below),
    // so most views need no token at all — only fetch/refresh one when this
    // row still has something missing, and kick it off now so it overlaps
    // with the workout+blocks query below instead of waiting behind it.
    const cachedStreams = activity.streamsJson as ParsedStreams | null;
    const needsLive =
      !activity.polyline ||
      activity.bestEffortsJson == null ||
      activity.cadenceSpm == null ||
      activity.calories == null ||
      activity.deviceName == null ||
      activity.gearName == null ||
      cachedStreams == null;
    const tokenPromise = needsLive && activity.stravaId ? getAccessToken() : null;

    // Fetch linked workout + blocks if present, in one query (relational
    // fetch) instead of two sequential round trips.
    let plannedWorkout: {
      id: string;
      type: string;
      title: string;
      blocks: Array<{
        type: string;
        distanceKm?: number;
        durationMinutes?: number;
        targetPaceSecKm?: number;
        reps?: number;
        repDistanceKm?: number;
      }>;
    } | null = null;

    if (activity.workoutId) {
      const workout = await db.query.workouts.findFirst({
        where: (w, { eq }) => eq(w.id, activity.workoutId!),
        with: { blocks: { orderBy: (b, { asc }) => [asc(b.sortOrder)] } },
      });

      if (workout) {
        plannedWorkout = {
          id: workout.id,
          type: workout.type,
          title: workout.title,
          blocks: workout.blocks.map((b) => ({
            type: b.type,
            ...(b.distanceKm != null ? { distanceKm: b.distanceKm } : {}),
            ...(b.durationMinutes != null
              ? { durationMinutes: b.durationMinutes }
              : {}),
            ...(b.targetPaceSecKm != null
              ? { targetPaceSecKm: b.targetPaceSecKm }
              : {}),
            ...(b.reps != null ? { reps: b.reps } : {}),
            ...(b.repDistanceKm != null
              ? { repDistanceKm: b.repDistanceKm }
              : {}),
          })),
        };
      }
    }

    // Fetch linked strength session, if any — the "Not linked to your plan"
    // prompt keys off this being present (see LinkActivitySection in the
    // client), and it was previously never populated, so linking an activity
    // to a strength session left the screen looking exactly like it had not
    // linked, even though the write succeeded.
    let linkedStrengthSession: { id: string; title: string; type: string } | null = null;
    if (activity.strengthSessionId) {
      const session = await db.query.strengthSessions.findFirst({
        where: (s, { eq }) => eq(s.id, activity.strengthSessionId!),
        columns: { id: true, title: true, type: true },
      });
      if (session) linkedStrengthSession = session;
    }

    // Parse splits and laps from stored JSON
    const splits = parseSplits(activity.splitsJson);
    const laps = parseLaps(activity.lapsJson);

    // Derive maxPaceSecKm from fastest split (lowest sec/km value that is > 0)
    const maxPaceSecKm =
      splits.length > 0
        ? splits.reduce(
            (fastest, s) =>
              s.paceSecKm > 0 && s.paceSecKm < fastest
                ? s.paceSecKm
                : fastest,
            Infinity
          )
        : null;

    // Nothing about a finished activity changes after it syncs, so a live
    // call only happens for whatever this row is still missing (populated at
    // import, or backfilled here for older rows) — same backfill-on-read
    // pattern the polyline established. needsLive/tokenPromise from above.
    let streams: ParsedStreams | null = cachedStreams;
    let live = EMPTY_LIVE_DETAIL;
    if (needsLive && activity.stravaId && tokenPromise) {
      const token = await tokenPromise;
      const [liveStreams, liveDetail] = await Promise.all([
        cachedStreams ? Promise.resolve(null) : fetchStravaStreams(activity.stravaId, token),
        fetchStravaDetail(activity.stravaId, token),
      ]);
      live = liveDetail;
      if (liveStreams) streams = liveStreams;

      // Back-fill whatever this row was still missing — cached once so the
      // screen survives Strava being unreachable, and never refetched again.
      const patch: Partial<typeof activities.$inferInsert> = {};
      if (!activity.polyline && live.polyline) patch.polyline = live.polyline;
      if (activity.bestEffortsJson == null) patch.bestEffortsJson = live.bestEfforts;
      if (activity.cadenceSpm == null) patch.cadenceSpm = live.cadenceSpm;
      if (activity.calories == null) patch.calories = live.calories;
      if (activity.deviceName == null) patch.deviceName = live.deviceName;
      if (activity.gearName == null) patch.gearName = live.gearName;
      if (!cachedStreams && liveStreams) patch.streamsJson = liveStreams;
      if (Object.keys(patch).length > 0) {
        try {
          await db.update(activities).set(patch).where(eq(activities.id, activity.id));
        } catch (err) {
          console.error("Failed to cache activity detail:", err);
        }
      }
    }

    const bestEfforts =
      (activity.bestEffortsJson as StravaLiveDetail["bestEfforts"] | null) ?? live.bestEfforts;

    return Response.json({
      id: activity.id,
      stravaId: activity.stravaId ?? "",
      // provider is dual-written alongside stravaId/garminId on every import
      // (see src/lib/activity-provider.ts) — a plain "which provider is
      // this" classification reads cleaner from it than chaining the two
      // legacy id columns.
      source: activity.provider ?? (activity.stravaId ? "strava" : activity.garminId ? "garmin" : "manual"),
      // The planned workout's title when it's linked, else what the device
      // called it — "Run" for everything erased strength sessions and names.
      name: plannedWorkout?.title ?? activity.name ?? "Run",
      // Sport hint for the client (share copy, run-only sections). Linked
      // strength sessions and strength_training/weight device types are strength.
      sportType: activity.strengthSessionId ? "strength" : activity.sportType ?? null,
      date: activity.startDate?.toISOString() ?? "",
      distanceKm: activity.distanceKm ?? 0,
      durationSeconds: activity.durationSeconds ?? 0,
      avgPaceSecKm: activity.avgPaceSecKm ?? 0,
      maxPaceSecKm: maxPaceSecKm === Infinity ? null : maxPaceSecKm,
      avgHr: activity.avgHr ?? null,
      maxHr: activity.maxHr ?? null,
      polyline: activity.polyline ?? live.polyline,
      cadenceSpm: activity.cadenceSpm ?? live.cadenceSpm,
      calories: activity.calories ?? live.calories,
      deviceName: activity.deviceName ?? live.deviceName,
      gearName: activity.gearName ?? live.gearName,
      aiInsight: activity.aiInsight ?? null,
      splits,
      laps,
      streams,
      bestEfforts,
      plannedWorkout,
      linkedStrengthSession,
    });
  } catch (err) {
    console.error("Error fetching activity detail:", err);
    return Response.json({ error: "Failed to fetch" }, { status: 500 });
  }
}

// ── PATCH /api/activities/[id] — link / unlink to a run or strength session ────
// Manual reconciliation: attach a recorded activity (with its HR)
// to a planned run workout or strength session, or detach it.

const LinkSchema = z
  .object({
    workoutId: z.string().uuid().optional(),
    strengthSessionId: z.string().uuid().optional(),
    unlink: z.boolean().optional(),
  })
  .strict();

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = LinkSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 422 });
  }
  const { workoutId, strengthSessionId, unlink } = parsed.data;

  try {
    const [activity] = await db.select().from(activities).where(eq(activities.id, id));
    if (!activity) return Response.json({ error: "Activity not found" }, { status: 404 });

    // Revert whatever this activity was previously linked to, back to planned.
    async function detachOld() {
      if (activity.workoutId) {
        await db
          .update(workouts)
          .set({ status: "planned", actualKm: null, stravaActivityId: null, updatedAt: new Date() })
          .where(eq(workouts.id, activity.workoutId));
      }
      if (activity.strengthSessionId) {
        await db
          .update(strengthSessions)
          .set({ status: "planned", durationMinutes: null, updatedAt: new Date() })
          .where(eq(strengthSessions.id, activity.strengthSessionId));
      }
    }

    if (unlink || (!workoutId && !strengthSessionId)) {
      await detachOld();
      const [updated] = await db
        .update(activities)
        .set({ workoutId: null, strengthSessionId: null })
        .where(eq(activities.id, id))
        .returning();
      return Response.json(updated);
    }

    if (workoutId) {
      const [w] = await db.select({ id: workouts.id }).from(workouts).where(eq(workouts.id, workoutId));
      if (!w) return Response.json({ error: "Workout not found" }, { status: 422 });
      await detachOld();
      await db
        .update(workouts)
        .set({
          status: "completed",
          actualKm: activity.distanceKm ?? null,
          stravaActivityId: activity.stravaId ?? null,
          updatedAt: new Date(),
        })
        .where(eq(workouts.id, workoutId));
      const [updated] = await db
        .update(activities)
        .set({ workoutId, strengthSessionId: null })
        .where(eq(activities.id, id))
        .returning();
      return Response.json(updated);
    }

    // strengthSessionId
    const [s] = await db.select({ id: strengthSessions.id }).from(strengthSessions).where(eq(strengthSessions.id, strengthSessionId!));
    if (!s) return Response.json({ error: "Strength session not found" }, { status: 422 });
    await detachOld();
    await db
      .update(strengthSessions)
      .set({
        status: "completed",
        durationMinutes: activity.durationSeconds ? Math.max(1, Math.round(activity.durationSeconds / 60)) : null,
        updatedAt: new Date(),
      })
      .where(eq(strengthSessions.id, strengthSessionId!));
    const [updated] = await db
      .update(activities)
      .set({ strengthSessionId, workoutId: null })
      .where(eq(activities.id, id))
      .returning();
    return Response.json(updated);
  } catch (err) {
    console.error("DB error linking activity:", err);
    return Response.json({ error: "Failed to link activity" }, { status: 500 });
  }
}

// ── DELETE /api/activities/[id] ──────────────────────────────────────────────
// Moves an activity to the trash (activity_trash, recoverable for 30 days via
// "Recently deleted"). Any workout / strength session it completed is reverted
// to planned, and sync tombstones stop Strava/Garmin re-imports.

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const [activity] = await db.select().from(activities).where(eq(activities.id, id));
    if (!activity) return Response.json({ error: "Activity not found" }, { status: 404 });

    // Keep the full row recoverable before anything is destroyed.
    await db
      .insert(activityTrash)
      .values({ id: activity.id, payload: rowToPayload(activity) })
      .onConflictDoNothing();

    if (activity.workoutId) {
      await db
        .update(workouts)
        .set({ status: "planned", actualKm: null, stravaActivityId: null, updatedAt: new Date() })
        .where(eq(workouts.id, activity.workoutId));
    }
    if (activity.strengthSessionId) {
      await db
        .update(strengthSessions)
        .set({ status: "planned", durationMinutes: null, updatedAt: new Date() })
        .where(eq(strengthSessions.id, activity.strengthSessionId));
    }
    if (activity.stravaId) {
      await db
        .insert(deletedActivities)
        .values({ stravaId: activity.stravaId })
        .onConflictDoNothing();
    }
    if (activity.garminId) {
      // Garmin-origin tombstone shares the table via a namespaced key so the
      // Garmin import never resurrects it.
      await db
        .insert(deletedActivities)
        .values({ stravaId: garminTombstoneKey(activity.garminId) })
        .onConflictDoNothing();
    }
    await db.delete(activities).where(eq(activities.id, id));
    return Response.json({ ok: true });
  } catch (err) {
    console.error("DB error deleting activity:", err);
    return Response.json({ error: "Failed to delete activity" }, { status: 500 });
  }
}

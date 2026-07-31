import { NextRequest } from "next/server";
import { z } from "zod";
import { db, activities, workouts, strengthSessions, deletedActivities, activityTrash } from "@/db";
import { and, eq } from "drizzle-orm";
import { getAccessToken } from "@/lib/sync/strava-client";
import { garminTombstoneKey } from "@/lib/sync/garmin-activity-import";
import { rowToPayload } from "@/lib/activity-trash";
import { currentUserId } from "@/db/with-user";
import { withSession } from "@/lib/api/with-session";
import { ownedBy, requireOwned } from "@/lib/api/owned";
import {
  EMPTY_LIVE_DETAIL,
  fetchStravaDetail,
  fetchStravaStreams,
  parseLaps,
  parseSplits,
  type ParsedStreams,
  type StravaLiveDetail,
} from "@/lib/activity-detail";

// ── Route handler ────────────────────────────────────────────────────────────

export const GET = withSession(async (
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;

  // Fetch activity row, outside the try below so its 404 (another athlete's
  // activity id, answered the same as a nonexistent one) reaches withSession
  // directly instead of being caught and turned into a 500.
  const activity = await requireOwned(activities, id);

  try {
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
    const tokenPromise = needsLive && activity.stravaId ? getAccessToken(currentUserId()) : null;

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
        where: (w, { and, eq }) =>
          and(eq(w.id, activity.workoutId!), eq(w.userId, currentUserId())),
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
        where: (s, { and, eq }) =>
          and(eq(s.id, activity.strengthSessionId!), eq(s.userId, currentUserId())),
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
          await db
            .update(activities)
            .set(patch)
            .where(and(eq(activities.id, activity.id), ownedBy(activities)));
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
});

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

export const PATCH = withSession(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
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

  // Outside the try below so its 404 reaches withSession directly.
  const activity = await requireOwned(activities, id);

  try {
    // Revert whatever this activity was previously linked to, back to planned.
    async function detachOld() {
      if (activity.workoutId) {
        await db
          .update(workouts)
          .set({ status: "planned", actualKm: null, stravaActivityId: null, updatedAt: new Date() })
          .where(and(eq(workouts.id, activity.workoutId), ownedBy(workouts)));
      }
      if (activity.strengthSessionId) {
        await db
          .update(strengthSessions)
          .set({ status: "planned", durationMinutes: null, updatedAt: new Date() })
          .where(and(eq(strengthSessions.id, activity.strengthSessionId), ownedBy(strengthSessions)));
      }
    }

    if (unlink || (!workoutId && !strengthSessionId)) {
      await detachOld();
      const [updated] = await db
        .update(activities)
        .set({ workoutId: null, strengthSessionId: null })
        .where(and(eq(activities.id, id), ownedBy(activities)))
        .returning();
      return Response.json(updated);
    }

    if (workoutId) {
      // Scoped by owner, not just id: an unscoped lookup would let a caller
      // link their activity to (and silently mark completed) someone else's
      // planned workout, which is a write, not just a read, leak.
      const [w] = await db
        .select({ id: workouts.id })
        .from(workouts)
        .where(and(eq(workouts.id, workoutId), ownedBy(workouts)));
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
        .where(and(eq(workouts.id, workoutId), ownedBy(workouts)));
      const [updated] = await db
        .update(activities)
        .set({ workoutId, strengthSessionId: null })
        .where(and(eq(activities.id, id), ownedBy(activities)))
        .returning();
      return Response.json(updated);
    }

    // strengthSessionId, same ownership scoping as the workout branch above.
    const [s] = await db
      .select({ id: strengthSessions.id })
      .from(strengthSessions)
      .where(and(eq(strengthSessions.id, strengthSessionId!), ownedBy(strengthSessions)));
    if (!s) return Response.json({ error: "Strength session not found" }, { status: 422 });
    await detachOld();
    await db
      .update(strengthSessions)
      .set({
        status: "completed",
        durationMinutes: activity.durationSeconds ? Math.max(1, Math.round(activity.durationSeconds / 60)) : null,
        updatedAt: new Date(),
      })
      .where(and(eq(strengthSessions.id, strengthSessionId!), ownedBy(strengthSessions)));
    const [updated] = await db
      .update(activities)
      .set({ strengthSessionId, workoutId: null })
      .where(and(eq(activities.id, id), ownedBy(activities)))
      .returning();
    return Response.json(updated);
  } catch (err) {
    console.error("DB error linking activity:", err);
    return Response.json({ error: "Failed to link activity" }, { status: 500 });
  }
});

// ── DELETE /api/activities/[id] ──────────────────────────────────────────────
// Moves an activity to the trash (activity_trash, recoverable for 30 days via
// "Recently deleted"). Any workout / strength session it completed is reverted
// to planned, and sync tombstones stop Strava/Garmin re-imports.

export const DELETE = withSession(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;

  // Outside the try below so its 404 reaches withSession directly.
  const activity = await requireOwned(activities, id);

  try {
    // Keep the full row recoverable before anything is destroyed.
    await db
      .insert(activityTrash)
      .values({ id: activity.id, payload: rowToPayload(activity), userId: currentUserId() })
      .onConflictDoNothing();

    if (activity.workoutId) {
      await db
        .update(workouts)
        .set({ status: "planned", actualKm: null, stravaActivityId: null, updatedAt: new Date() })
        .where(and(eq(workouts.id, activity.workoutId), ownedBy(workouts)));
    }
    if (activity.strengthSessionId) {
      await db
        .update(strengthSessions)
        .set({ status: "planned", durationMinutes: null, updatedAt: new Date() })
        .where(and(eq(strengthSessions.id, activity.strengthSessionId), ownedBy(strengthSessions)));
    }
    if (activity.stravaId) {
      await db
        .insert(deletedActivities)
        .values({ stravaId: activity.stravaId, userId: currentUserId() })
        .onConflictDoNothing();
    }
    if (activity.garminId) {
      // Garmin-origin tombstone shares the table via a namespaced key so the
      // Garmin import never resurrects it.
      await db
        .insert(deletedActivities)
        .values({ stravaId: garminTombstoneKey(activity.garminId), userId: currentUserId() })
        .onConflictDoNothing();
    }
    await db.delete(activities).where(and(eq(activities.id, id), ownedBy(activities)));
    return Response.json({ ok: true });
  } catch (err) {
    console.error("DB error deleting activity:", err);
    return Response.json({ error: "Failed to delete activity" }, { status: 500 });
  }
});

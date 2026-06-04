import { db, activities, workouts, blocks } from "@/db";
import { eq } from "drizzle-orm";
import { getAccessToken } from "@/lib/sync/strava-client";

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

interface StravaStreams {
  distance?: { data: number[] };
  heartrate?: { data: number[] };
  velocity_smooth?: { data: number[] };
  altitude?: { data: number[] };
  latlng?: { data: [number, number][] };
  time?: { data: number[] };
}

interface StravaDetailedActivity {
  name?: string;
  best_efforts?: Array<{
    name: string;
    distance: number;
    elapsed_time: number;
    moving_time: number;
  }>;
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

async function fetchStravaStreams(stravaId: string) {
  try {
    const token = await getAccessToken();
    const res = await fetch(
      `${STRAVA_API}/activities/${stravaId}/streams?keys=heartrate,velocity_smooth,altitude,latlng,distance,time&resolution=medium`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return null;
    const data: StravaStreams[] = await res.json();
    // Strava returns an array of stream objects keyed by `type`
    const map: Record<string, unknown[]> = {};
    for (const stream of data) {
      const entries = Object.entries(stream) as [
        string,
        { data: unknown[] }
      ][];
      for (const [key, val] of entries) {
        if (val?.data) map[key] = val.data;
      }
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

async function fetchStravaBestEfforts(
  stravaId: string
): Promise<
  Array<{
    name: string;
    distance: number;
    elapsedTime: number;
    movingTime: number;
  }>
> {
  try {
    const token = await getAccessToken();
    const res = await fetch(`${STRAVA_API}/activities/${stravaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const data: StravaDetailedActivity = await res.json();
    return (data.best_efforts ?? []).map((e) => ({
      name: e.name,
      distance: e.distance,
      elapsedTime: e.elapsed_time,
      movingTime: e.moving_time,
    }));
  } catch {
    return [];
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

    // Fetch linked workout + blocks if present
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
      const [workout] = await db
        .select()
        .from(workouts)
        .where(eq(workouts.id, activity.workoutId))
        .limit(1);

      if (workout) {
        const workoutBlocks = await db
          .select()
          .from(blocks)
          .where(eq(blocks.workoutId, workout.id))
          .orderBy(blocks.sortOrder);

        plannedWorkout = {
          id: workout.id,
          type: workout.type,
          title: workout.title,
          blocks: workoutBlocks.map((b) => ({
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

    // Fetch Strava streams and best efforts in parallel
    const [streams, bestEfforts] = await Promise.all([
      activity.stravaId ? fetchStravaStreams(activity.stravaId) : null,
      activity.stravaId ? fetchStravaBestEfforts(activity.stravaId) : [],
    ]);

    return Response.json({
      id: activity.id,
      stravaId: activity.stravaId ?? "",
      name: plannedWorkout?.title ?? "Run",
      date: activity.startDate?.toISOString() ?? "",
      distanceKm: activity.distanceKm ?? 0,
      durationSeconds: activity.durationSeconds ?? 0,
      avgPaceSecKm: activity.avgPaceSecKm ?? 0,
      maxPaceSecKm: maxPaceSecKm === Infinity ? null : maxPaceSecKm,
      avgHr: activity.avgHr ?? null,
      maxHr: activity.maxHr ?? null,
      splits,
      laps,
      streams,
      bestEfforts,
      plannedWorkout,
    });
  } catch (err) {
    console.error("Error fetching activity detail:", err);
    return Response.json({ error: "Failed to fetch" }, { status: 500 });
  }
}

// Pure mapping from a Strava activity payload to the `activities` columns
// that should follow Strava. No DB imports here — same pattern as
// workout-match.ts, so this stays unit-testable without a database.
//
// Deliberately excluded (Kadenz-side state, never touched by a Strava sync):
// id, workoutId, strengthSessionId, stravaId, garminId, aiInsight,
// aiInsightGeneratedAt, streamsJson, createdAt. A Strava-side edit (fixing a
// title, a GPS-drift distance, etc.) must never re-run workout matching or
// drop the link to a planned workout/strength session — that link is set once
// at import and is Kadenz's, not Strava's.

export interface StravaActivity {
  id: number;
  name: string;
  type: string;
  sport_type: string;
  distance: number; // meters
  moving_time: number; // seconds
  elapsed_time: number; // seconds
  start_date: string; // ISO
  start_date_local: string; // ISO
  average_speed: number; // m/s
  max_speed: number; // m/s
  total_elevation_gain?: number;
  elev_high?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  // Strava reports running cadence in strides/min (one leg) — ×2 for spm.
  average_cadence?: number;
  calories?: number;
  device_name?: string;
  gear?: { id: string; name: string };
  map?: { summary_polyline?: string };
  best_efforts?: Array<{
    name: string;
    distance: number;
    elapsed_time: number;
    moving_time: number;
  }>;
  splits_metric?: Array<{
    distance: number;
    elapsed_time: number;
    moving_time: number;
    average_speed: number;
    average_heartrate?: number;
    pace_zone: number;
    split: number;
  }>;
  laps?: Array<{
    id: number;
    name: string;
    distance: number;
    elapsed_time: number;
    moving_time: number;
    average_speed: number;
    average_heartrate?: number;
    max_heartrate?: number;
    lap_index: number;
  }>;
}

// Strava sport types we treat as a strength/lifting session.
export const STRENGTH_SPORT_TYPES = new Set(["WeightTraining", "Workout", "Crossfit", "HIIT"]);

export function isRunActivity(activity: Pick<StravaActivity, "sport_type" | "type">): boolean {
  return activity.sport_type === "Run" || activity.type === "Run";
}

export function isStrengthActivity(activity: Pick<StravaActivity, "sport_type" | "type">): boolean {
  const sportType = activity.sport_type || activity.type;
  return STRENGTH_SPORT_TYPES.has(sportType);
}

/** Fields shared by every activity kind — set on both create and update. */
export interface CommonStravaFields {
  sportType: string;
  name: string;
  startDate: Date;
  durationSeconds: number;
  avgHr: number | null;
  maxHr: number | null;
}

/** Run-only fields, added on top of the common ones. */
export interface RunStravaFields {
  distanceKm: number;
  avgPaceSecKm: number | null;
  elevationGain: number | null;
  maxElevation: number | null;
  splitsJson: StravaActivity["splits_metric"] | null;
  lapsJson: StravaActivity["laps"] | null;
  polyline: string | null;
  bestEffortsJson: StravaActivity["best_efforts"] | null;
  cadenceSpm: number | null;
  calories: number | null;
  deviceName: string | null;
  gearName: string | null;
}

export function commonStravaFields(activity: StravaActivity): CommonStravaFields {
  return {
    sportType: activity.sport_type || activity.type,
    name: activity.name,
    startDate: new Date(activity.start_date),
    durationSeconds: activity.moving_time,
    avgHr: activity.average_heartrate ? Math.round(activity.average_heartrate) : null,
    maxHr: activity.max_heartrate ? Math.round(activity.max_heartrate) : null,
  };
}

export function runStravaFields(activity: StravaActivity): RunStravaFields {
  return {
    distanceKm: activity.distance / 1000,
    avgPaceSecKm:
      activity.average_speed > 0 ? Math.round(1000 / activity.average_speed) : null,
    elevationGain: activity.total_elevation_gain ?? null,
    maxElevation: activity.elev_high ?? null,
    splitsJson: activity.splits_metric ?? null,
    lapsJson: activity.laps ?? null,
    polyline: activity.map?.summary_polyline || null,
    bestEffortsJson: activity.best_efforts ?? null,
    cadenceSpm:
      activity.average_cadence != null && activity.average_cadence > 0
        ? Math.round(activity.average_cadence * 2)
        : null,
    calories: activity.calories != null ? Math.round(activity.calories) : null,
    deviceName: activity.device_name ?? null,
    gearName: activity.gear?.name ?? null,
  };
}

/**
 * The full set of Strava-sourced fields for an UPDATE of an already-stored
 * activity. Mirrors what processActivity() writes on first import, minus
 * everything Kadenz owns (see file header). Used for both "create" (fresh
 * insert) and "update" (refresh of an existing row) so the two never drift.
 */
export function stravaUpdateFields(
  activity: StravaActivity
): CommonStravaFields | (CommonStravaFields & RunStravaFields) {
  const common = commonStravaFields(activity);
  if (isRunActivity(activity)) {
    return { ...common, ...runStravaFields(activity) };
  }
  return common;
}

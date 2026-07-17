// ── Garmin activity-import helpers (pure) ────────────────────────────────────
// No DB imports here: these functions are unit-tested standalone. The DB-backed
// import runner lives in garmin-activity-import.ts.

import type { GarminSplit } from "./garmin-client";

// ── Dedupe window ────────────────────────────────────────────────────────────
// The same run usually arrives twice: via the Strava webhook and via the Garmin
// worker. Treat an incoming Garmin activity as a duplicate of an existing row
// when the start times are within ±10 minutes AND the durations are within
// ±15% (a missing duration on either side falls back to the time window alone).

const START_WINDOW_MS = 10 * 60 * 1000;
const DURATION_TOLERANCE = 0.15;

export interface ExistingActivityLike {
  startDate: Date | null;
  durationSeconds: number | null;
}

export function isDuplicateActivity(
  candidate: { startDate: Date; durationSeconds: number | null },
  existing: ExistingActivityLike[]
): boolean {
  return existing.some((e) => {
    if (!e.startDate) return false;
    const startDiff = Math.abs(e.startDate.getTime() - candidate.startDate.getTime());
    if (startDiff > START_WINDOW_MS) return false;
    if (candidate.durationSeconds == null || e.durationSeconds == null) return true;
    if (e.durationSeconds === 0 && candidate.durationSeconds === 0) return true;
    const base = Math.max(e.durationSeconds, candidate.durationSeconds);
    if (base === 0) return true;
    const diff = Math.abs(e.durationSeconds - candidate.durationSeconds);
    return diff / base <= DURATION_TOLERANCE;
  });
}

// ── Splits mapping ───────────────────────────────────────────────────────────
// The app reads splitsJson in the Strava splits_metric shape (see parseSplits
// in api/activities/[id]/route.ts and the HR-zone consumers): per-km objects
// with split / distance (m) / moving_time / elapsed_time / average_speed (m/s)
// / average_heartrate. Normalize the worker's splits to that shape.

export interface StravaLikeSplit {
  split: number;
  distance: number; // meters
  moving_time: number; // seconds
  elapsed_time: number; // seconds
  average_speed: number; // m/s
  average_heartrate?: number;
}

export function mapGarminSplits(splits: GarminSplit[]): StravaLikeSplit[] {
  return splits.map((s, i) => {
    const distanceMeters = s.distanceKm * 1000;
    // Prefer the explicit pace; fall back to distance/duration.
    const speed =
      s.avgPaceSecPerKm && s.avgPaceSecPerKm > 0
        ? 1000 / s.avgPaceSecPerKm
        : s.durationSeconds > 0
          ? distanceMeters / s.durationSeconds
          : 0;
    return {
      split: i + 1,
      distance: distanceMeters,
      moving_time: s.durationSeconds,
      elapsed_time: s.durationSeconds,
      average_speed: speed,
      ...(s.avgHr != null ? { average_heartrate: s.avgHr } : {}),
    };
  });
}

// ── Timestamp parsing ────────────────────────────────────────────────────────

/** Garmin timestamps come as "YYYY-MM-DD HH:MM:SS" (list route) or ISO-T
 * (detail route), usually without a timezone marker. Normalize the separator;
 * the GMT variant additionally forces UTC when no offset is present. */
export function normalizeLocalTimestamp(value: string): string {
  return value.replace(" ", "T");
}

export function parseGmtTimestamp(value: string): Date {
  const normalized = normalizeLocalTimestamp(value);
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(normalized);
  return new Date(hasZone ? normalized : `${normalized}Z`);
}

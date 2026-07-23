// ── Sport bucketing ───────────────────────────────────────────────────────────
// Collapses the many Strava/Garmin sport_type strings (Run, TrailRun,
// VirtualRide, WeightTraining, …) into a small set of buckets the UI can filter
// by. Running-first today; cycling/swimming buckets light up automatically if
// such activities ever land.

export type SportBucket = "run" | "ride" | "swim" | "strength" | "other";

export const SPORT_LABEL: Record<SportBucket, string> = {
  run: "Runs",
  ride: "Cycling",
  swim: "Swimming",
  strength: "Strength",
  other: "Other",
};

// Display order for selectors.
export const SPORT_ORDER: SportBucket[] = ["run", "ride", "swim", "strength", "other"];

/**
 * Bucket an activity. A linked strength session is authoritative; otherwise the
 * sport_type string decides. A null/empty sport_type is treated as a run — the
 * app is running-first and legacy runs were imported without a type.
 */
export function sportBucket(
  sportType: string | null | undefined,
  hasStrengthSession: boolean
): SportBucket {
  if (hasStrengthSession) return "strength";
  const t = (sportType ?? "").toLowerCase();
  if (!t) return "run";
  if (
    t.includes("weight") ||
    t.includes("workout") ||
    t.includes("crossfit") ||
    t.includes("hiit") ||
    t.includes("strength")
  ) {
    return "strength";
  }
  if (t.includes("run")) return "run";
  if (t.includes("ride") || t.includes("cycl") || t.includes("bike") || t.includes("biking")) {
    return "ride";
  }
  if (t.includes("swim")) return "swim";
  return "other";
}

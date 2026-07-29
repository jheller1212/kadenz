// ── Strength session match selection (pure) ──────────────────────────────────
// No DB imports here: this is the selection half of strava-client.ts's
// findMatchingStrengthSession / garmin-activity-import.ts's importStrength,
// split out so it stays unit-testable without a database (same pattern as
// workout-match.ts).
//
// The signal: strength_sets.createdAt is a real wall-clock timestamp of when
// each set was logged, so the span from the first to the last logged set is
// an actual time window for the session — comparable to the activity's
// start/end. That is a much stronger signal than "same calendar day", which
// is all findMatchingStrengthSession used before this.
//
// Rule, in order:
//  1. A session with no logged sets yet has no time window to compare — it
//     can only be matched by the day-level fallback, and only when it's the
//     sole candidate (nothing to disambiguate against).
//  2. A session with logged sets is only a candidate if its set window comes
//     within MATCH_TOLERANCE_MS of the activity's [start, start+duration]
//     window — a plain gap check, not "same day".
//  3. Among candidates that pass, the one with the largest overlap (by
//     interval intersection, which is negative for a gap and positive for
//     real overlap) wins. A tie between the top two is left unlinked —
//     linking either would be a coin flip, and a coin flip is worse than
//     asking the athlete to attach it by hand.

// Tolerance for the gap between the activity's recorded window and a
// session's logged-sets window. Generous on purpose: a set's createdAt marks
// roughly when it ENDED (see alignSetHeartRate below), so the true workout
// start is earlier than the first set's timestamp by however long the warm-up
// and first working set took, and the watch recording commonly runs a bit
// past the last set (walking back from the gym floor, cooldown). 20 minutes
// covers that without also swallowing a genuinely different session an hour
// away.
export const STRENGTH_MATCH_TOLERANCE_MS = 20 * 60 * 1000;

export interface Interval {
  start: Date;
  end: Date;
}

export interface StrengthSessionCandidate {
  id: string;
  status: string;
  /** [min(createdAt), max(createdAt)] over this session's logged sets, or
   *  null if none are logged yet. */
  setsWindow: Interval | null;
}

/** Interval intersection in ms: positive = real overlap, negative = gap size. */
function windowScore(a: Interval, b: Interval): number {
  return (
    Math.min(a.end.getTime(), b.end.getTime()) -
    Math.max(a.start.getTime(), b.start.getTime())
  );
}

/**
 * Pure selection: given open (unlinked, non-guest, non-skipped) strength
 * session candidates for the day and the activity's recorded window, pick
 * the one session it belongs to, or null when that isn't safe to decide.
 */
export function pickStrengthSessionMatch(
  activityWindow: Interval,
  candidates: StrengthSessionCandidate[],
  toleranceMs: number = STRENGTH_MATCH_TOLERANCE_MS
): string | null {
  if (candidates.length === 0) return null;

  const timed = candidates.filter(
    (c): c is StrengthSessionCandidate & { setsWindow: Interval } => c.setsWindow != null
  );

  if (timed.length === 0) {
    // Nothing logged yet for any candidate — an activity that arrived before
    // the session was finished (or before any set was logged at all). Only
    // safe to accept when there's exactly one candidate to begin with.
    return candidates.length === 1 ? candidates[0].id : null;
  }

  const scored = timed
    .map((c) => ({ id: c.id, score: windowScore(activityWindow, c.setsWindow) }))
    .filter((s) => s.score > -toleranceMs)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;
  if (scored.length > 1 && scored[0].score === scored[1].score) return null;
  return scored[0].id;
}

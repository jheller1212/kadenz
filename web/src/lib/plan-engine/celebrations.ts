// ── Longer-arc celebration moments ──────────────────────────────────────────
//
// The per-session celebration (WorkoutCelebration) fires on every completed
// workout — cheap and frequent. These fire far more rarely, so they need to
// be right rather than novel: a week that was mostly missed must never read
// as a win just because the athlete happened to tap "complete" on its last
// remaining workout. Every check here is derived from real workout/week/plan
// state (status columns, week.phase, plan.status), never a counter that
// could drift from what actually happened.

export interface CelebrationWorkout {
  type: string;
  status: string;
}

/**
 * A week is "complete" only when every workout that was actually scheduled
 * in it (rest days don't count — there's nothing to complete) finished with
 * status "completed". A single missed or skipped workout anywhere in the
 * week fails this — deliberately: a celebration for a week the athlete
 * mostly missed is worse than none at all.
 *
 * `skippedAt` set means the athlete dropped the whole week (illness/travel —
 * see weeks.skippedAt) — never a completion, however many of its workouts
 * happen to carry status "completed" from before the drop.
 */
export function isWeekComplete(
  workouts: CelebrationWorkout[],
  skippedAt: unknown
): boolean {
  if (skippedAt) return false;
  const scheduled = workouts.filter((w) => w.type !== "rest");
  if (scheduled.length === 0) return false; // nothing scheduled — not a completion
  return scheduled.every((w) => w.status === "completed");
}

export type WeekMilestone = "week" | "peak-week" | null;

/**
 * Which week-level celebration (if any) a just-completed workout unlocked.
 * "peak-week" only when the week that just finished is genuinely in the
 * running plan's peak phase (see phase-policy.ts) — every other complete
 * week gets the plain "week" moment.
 */
export function weekMilestoneFor(
  phase: string | null | undefined,
  skippedAt: unknown,
  workouts: CelebrationWorkout[]
): WeekMilestone {
  if (!isWeekComplete(workouts, skippedAt)) return null;
  return phase === "peak" ? "peak-week" : "week";
}

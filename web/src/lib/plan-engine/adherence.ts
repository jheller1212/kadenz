// Whether an athlete is visibly behind their plan — not "missed today's
// run" (see PlanAdjustmentTray, which handles the current week), but a
// trend: has training actually been happening, over a window wide enough
// that one bad week isn't mistaken for falling off the plan. Pure and
// DB-free so the rule is unit-testable on its own, same reasoning as
// regenerate-merge.ts and fitness-estimate.ts.

import { isPastDuePlanned } from "@/lib/training/session";

export interface AdherenceWorkoutInput {
  date: Date;
  status: "planned" | "completed" | "skipped" | "missed";
  type: string;
}

export interface BehindPlanResult {
  behind: boolean;
  missedCount: number;
  consideredCount: number;
  missedRatio: number;
}

/** Roughly one training-block subdivision: long enough that a single rough
 *  week doesn't trip it, short enough to reflect the athlete's CURRENT
 *  trajectory rather than their whole history. */
export const ADHERENCE_WINDOW_DAYS = 21;

/** Below this many considered sessions the ratio is noise, not a signal —
 *  two missed runs out of two scheduled is a data-free stretch, not
 *  evidence of falling behind. */
const MIN_CONSIDERED = 4;

/** Missing roughly two sessions in every five is the point an athlete is
 *  meaningfully off track rather than having had one rough day. */
const MISSED_RATIO_THRESHOLD = 0.4;

/**
 * Detects "behind plan" from what was actually scheduled and what happened
 * to it, as a ratio over a rolling window — not a fixed "missed 3 in a row"
 * count, so a 3-run/week plan and a 6-run/week plan are judged on the same
 * footing.
 *
 * "skipped" (an explicit skip-week, or the athlete's own deliberate skip via
 * the plan-adjustment tray) is excluded entirely: that is the plan being
 * told something changed, not evidence the athlete is falling behind it.
 * A `missed` row and a still-`planned` row whose date has already passed
 * both count as missed (see isPastDuePlanned) — the status flip may not
 * have run yet, but the session did not happen either way.
 */
export function detectBehindPlan(
  workouts: AdherenceWorkoutInput[],
  now: Date = new Date(),
  windowDays: number = ADHERENCE_WINDOW_DAYS
): BehindPlanResult {
  const cutoff = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const isMissed = (w: AdherenceWorkoutInput) =>
    w.status === "missed" || (w.status === "planned" && isPastDuePlanned(w, now));

  const considered = workouts.filter((w) => {
    if (w.type === "rest") return false;
    if (w.date < cutoff || w.date > now) return false;
    if (w.status === "skipped") return false;
    return w.status === "completed" || isMissed(w);
  });

  const missedCount = considered.filter(isMissed).length;
  const consideredCount = considered.length;
  const missedRatio = consideredCount > 0 ? missedCount / consideredCount : 0;

  return {
    behind: consideredCount >= MIN_CONSIDERED && missedRatio >= MISSED_RATIO_THRESHOLD,
    missedCount,
    consideredCount,
    missedRatio,
  };
}

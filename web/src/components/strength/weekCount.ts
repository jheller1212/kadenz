// Single place that turns "scheduled this week" vs "the athlete's configured
// weekly target" into honest copy. Before this, WeeklyStrengthPlan showed the
// target (always N) and Today's header showed what actually got scheduled
// (often N-1) — both correct in isolation, contradictory side by side, with
// nothing explaining the gap. See docs/DUPLICATION.md: one fact (how many
// strength sessions this week), several places computing/describing it.
//
// The three real causes a week falls short of target (see reconcile.ts):
//   - the week was already partly elapsed when the schedule filled it in
//     (Monday had passed, so this week only ever got the remaining days)
//   - it's a deload/taper/peak week, which deliberately drops one
//     (reconcile.ts weekBudgetFor)
//   - the placement engine genuinely couldn't fit them all without breaking
//     a hard rule (reconcile.ts computeTopUpPlacements's `shortWeeks`)
// Every surface should ask this one function "why", not invent its own guess.

export interface StrengthPhaseInfo {
  /** Raw run-plan phase for the week ("base" | "build" | "peak" | "taper"), or
   * null with no active running plan. See phase-policy.ts phaseSummaryFor. */
  phase: string | null;
  phaseLabel: string | null;
  /** Human sentence already crafted server-side (e.g. mentions "Deload"),
   * used as a last-resort source for the deload case, which isn't otherwise
   * distinguishable from `phase` (deload is a week `type`, not a `phase`). */
  note?: string | null;
}

export function strengthWeekShortfallReason(opts: {
  scheduled: number;
  target: number;
  /** True only for the CURRENT calendar week, and only when some of its days
   * are already in the past — the "Monday had already passed" case. */
  weekPartElapsed?: boolean;
  /** Sessions the weekly top-up couldn't place without a hard-rule conflict
   * (ensure endpoint's `shortWeeks` > 0 for this week). */
  placementShortfall?: boolean;
  phase?: StrengthPhaseInfo | null;
}): string | null {
  const { scheduled, target } = opts;
  if (target <= 0 || scheduled >= target) return null;

  if (opts.phase?.phase === "taper" || opts.phase?.phase === "peak") {
    const label = opts.phase.phaseLabel ?? "this";
    return `${label} week — the plan drops one on purpose while running load is high.`;
  }
  if (opts.phase?.note && /deload/i.test(opts.phase.note)) {
    return "Deload week — the plan drops one on purpose.";
  }
  if (opts.placementShortfall) {
    return "Couldn't fit the full count without landing on a hard-run day.";
  }
  if (opts.weekPartElapsed) {
    return "This week was already underway when the schedule filled in.";
  }
  return null;
}

/** "3 of 4 this week" — the shared numerator/denominator phrasing. */
export function strengthWeekCountLabel(scheduled: number, target: number): string {
  return `${scheduled} of ${target} this week`;
}

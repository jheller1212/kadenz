// ── Which "you have no running plan" screen to show ─────────────────────────
//
// Extracted from the JSX so the decision can be tested, because getting it
// wrong is not a cosmetic problem: Today showed one screen — "Ready to train?
// Create a personalised race plan" — to everybody without an active running
// plan. That included an athlete whose Kraft plan was switched on, with
// strength sessions scheduled for the week and already pushed to their watch.
// The app said "you have nothing" while their Garmin said otherwise, and
// offered no way in to the plan that did exist.
//
// The mistake was treating "no running plan" and "no plan at all" as the same
// state. They are three:

export type TodayEmptyState =
  /** The request failed. Says so, and offers a retry — never "create a plan",
   *  which would invite someone to build a second plan over one that loaded
   *  badly. */
  | "error"
  /** No running plan, but Kraft IS on. Lead with the plan that exists. */
  | "kraft-running"
  /** Genuinely nothing. Offer both, since Kraft is a plan in its own right. */
  | "nothing";

export function todayEmptyState(opts: {
  error?: boolean;
  kraftActive?: boolean | null;
}): TodayEmptyState {
  if (opts.error) return "error";
  // `null` means bootstrap has not answered yet. Treated as "nothing" only
  // because that is the pre-existing copy; it resolves within the same load,
  // and guessing "kraft-running" would flash a claim that may be false.
  return opts.kraftActive === true ? "kraft-running" : "nothing";
}

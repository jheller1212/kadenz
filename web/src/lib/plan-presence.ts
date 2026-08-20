// ── What the Plan tab should say about each plan ────────────────────────────
//
// Extracted so the states can be tested without rendering, and because the
// distinction they encode is the one the app kept getting wrong: Kadenz has
// TWO independent plans, and "no running plan" was repeatedly treated as "no
// plans at all". Today showed "Ready to train?" and the Plan tab showed "Build
// your plan" to an athlete whose Kraft sessions were scheduled for that week
// and already pushed to their watch.

export type PlanPresence =
  /** Running now — offer to remove it. */
  | "active"
  /** Set up once, currently switched off. Kraft only: the settings row still
   *  exists, so this is "start it again", not "set it up". */
  | "stopped"
  /** Never set up, or removed entirely — offer to add one. */
  | "none";

export function runPlanPresence(runPlan: { id: string } | null | undefined): PlanPresence {
  return runPlan ? "active" : "none";
}

export function strengthPlanPresence(
  strengthPlan: { active: boolean } | null | undefined
): PlanPresence {
  if (!strengthPlan) return "none";
  return strengthPlan.active ? "active" : "stopped";
}

/** True when the athlete has no plan of either kind — the only situation in
 *  which the Plan tab should lead with an empty state rather than an overview. */
export function hasNoPlans(
  runPlan: { id: string } | null | undefined,
  strengthPlan: { active: boolean } | null | undefined
): boolean {
  return runPlanPresence(runPlan) === "none" && strengthPlanPresence(strengthPlan) !== "active";
}

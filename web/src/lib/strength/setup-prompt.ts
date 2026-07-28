/**
 * Should the Kraft picker show a "set up your equipment" prompt?
 *
 * True exactly when there is no `strength_plan_settings` row for the active
 * profile — GET /api/strength/plan-settings returns `null` in that case.
 * With no row, `equipment` and `ability` fall back to unfiltered/undefined
 * (see service.ts derivePlanSettingsForLoads), so a first-time athlete can
 * get a session prescribing gear they don't have with no indication their
 * profile is unconfigured. Once a row exists — even with an empty equipment
 * list, meaning "bodyweight only" — the athlete has made a deliberate
 * choice and the prompt should not show.
 */
export function needsStrengthSetupPrompt(planSettings: unknown): boolean {
  return planSettings == null;
}

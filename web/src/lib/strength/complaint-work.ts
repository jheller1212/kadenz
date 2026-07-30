import { ACHILLES_COMPLAINT_SLOTS, EXERCISE_BY_SLUG, TARGETED_WORK } from "./program";
import { COMPLAINT_SHORT_LABELS, STRENGTH_COMPLAINTS, type Complaint } from "./types";

// ── Which exercises belong to which complaint ────────────────────────────────
//
// One place that answers "is this exercise here because of a complaint, and
// which one?". Several screens used to answer it with a hardcoded
// `category === "achilles"` or `type === "lower_achilles"` test, which showed
// Achilles wording to every athlete and showed nothing to an athlete whose
// complaint was a knee. The templates already know the answer
// (ACHILLES_COMPLAINT_SLOTS + TARGETED_WORK in program.ts), so derive it from
// them rather than restating it per screen.

/** Every exercise slug the given complaint can put into a session. */
export function complaintWorkSlugs(complaint: Complaint): string[] {
  if (complaint === "achilles") {
    return ACHILLES_COMPLAINT_SLOTS.map((s) => s.exerciseSlug);
  }
  const targeted = TARGETED_WORK[complaint];
  if (!targeted) return [];
  // A targeted slot can resolve to a bodyweight fallback when the athlete
  // lacks the kit (see resolveSlotVariant), so its variants count as that
  // complaint's work too.
  const variants = targeted.slot.variants?.map((v) => v.exerciseSlug) ?? [];
  return [...new Set([targeted.slug, ...variants])];
}

/** Exercise slugs that are complaint work for THIS athlete's complaints. */
export function complaintWorkSlugsFor(complaints: Complaint[]): Set<string> {
  return new Set(complaints.flatMap(complaintWorkSlugs));
}

/**
 * Every slug that is complaint work for some complaint. Used for history,
 * where the question is "was this exercise ever rehab work?" rather than "is
 * it now" — an athlete who has recovered still gets to see the pain scores
 * they logged at the time (see isPainTrackedExercise).
 */
export const ALL_COMPLAINT_WORK_SLUGS: Set<string> = new Set(
  STRENGTH_COMPLAINTS.flatMap(complaintWorkSlugs)
);

/**
 * Should this exercise's chart overlay pain scores?
 *
 * Pain logs are per session, not per exercise, so the overlay only makes
 * sense on the work the check-in was about. Two ways an exercise qualifies:
 *   • it is complaint work for a complaint the athlete currently reports —
 *     the overlay is there before there is anything to plot;
 *   • it is complaint work for any complaint AND has pain logged against it —
 *     removing a complaint hides the overlay on future generic work, it does
 *     not erase scores already recorded (they stay in `pain_logs` either way).
 */
export function isPainTrackedExercise(
  slug: string,
  complaints: Complaint[],
  hasPainPoints: boolean
): boolean {
  if (complaintWorkSlugsFor(complaints).has(slug)) return true;
  return hasPainPoints && ALL_COMPLAINT_WORK_SLUGS.has(slug);
}

/** "Achilles", "knee and shin", "Achilles, knee and hamstring". */
export function complaintListLabel(complaints: Complaint[]): string {
  const words = complaints.map((c) => COMPLAINT_SHORT_LABELS[c]);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/**
 * Does this list of exercises fall under the Achilles ordering rule?
 *
 * The rule (validateAchillesOrdering in session.ts) only bites when a session
 * holds both an explosive and a slow heavy exercise, so the banner announcing
 * it is gated on the same condition. Gating on `type === "lower_achilles"`
 * instead used to miss every current session, because Achilles work now
 * arrives as extra slots inside ordinary lower/full_body/upper sessions.
 */
export function hasAchillesOrdering(slugs: string[]): boolean {
  let explosive = false;
  let slowHeavy = false;
  for (const slug of slugs) {
    const role = EXERCISE_BY_SLUG[slug]?.achillesRole;
    if (role === "explosive") explosive = true;
    if (role === "slow_heavy") slowHeavy = true;
  }
  return explosive && slowHeavy;
}

// ── HSR ramp week ────────────────────────────────────────────────────────────
//
// The HSR calf protocol (hsrPrescriptionForWeek) ramps load by week. It used
// to be handed the RUNNING plan's week number, which is the wrong clock: an
// athlete who reports Achilles pain in week 14 of a marathon block would be
// started on the week 5+ single-leg load on day one, and an athlete who
// removes the complaint and re-reports it a month later would resume at
// whatever the running plan had reached rather than rebuilding the tendon's
// tolerance.
//
// So the ramp runs off its own clock: the moment the athlete reported the
// Achilles complaint (strength_plan_settings.achilles_started_at). Removing
// the complaint clears it, and re-reporting sets it again, which means the
// protocol deliberately RESTARTS at week 1. That is the safe direction: the
// only cost of restarting is a few light weeks, while resuming a ramp on a
// tendon that has not been loaded for a month is how people get re-injured.

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * 1-based week of the HSR ramp for a session on `sessionDate`.
 * `startedAt` null (no Achilles complaint recorded, or a settings row that
 * predates this column) falls back to `programWeek`, the previous behaviour.
 */
export function achillesProgramWeek(
  startedAt: Date | null | undefined,
  sessionDate: Date,
  programWeek: number
): number {
  if (!startedAt) return programWeek;
  const elapsed = sessionDate.getTime() - startedAt.getTime();
  if (elapsed < 0) return 1;
  return Math.floor(elapsed / MS_PER_WEEK) + 1;
}

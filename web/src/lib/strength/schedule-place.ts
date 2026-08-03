import type { Complaint, StrengthSessionType } from "./types";
import { HARD_RUN_TYPES, hasAchillesBlock } from "./constraints";
import { EXERCISE_BY_SLUG, sessionTemplateFor } from "./program";
import { muscleGroupFor, type MuscleGroup } from "./muscle-groups";

// ── Coach-style weekly placement (pure, unit-tested) ─────────────────────────
// Places a week's strength sessions around the run schedule the way a coach
// would: heavy leg work never lands on or directly before a hard run, easy
// days absorb the lighter sessions, same-muscle-group strength days are kept
// apart, and a slot is dropped entirely rather than break a hard rule.

export interface PlacementDay {
  /** Stable key for the calendar day (e.g. "2026-07-15"). */
  key: string;
  /** 0=Sun … 6=Sat, in the athlete's timezone. */
  dow: number;
  /** Run planned this day, if any (workout type). */
  runType: string | null;
  /** Run planned the following day, if any. */
  nextDayRunType: string | null;
  /** Day already holds a strength session (manual or auto). */
  taken: boolean;
  /**
   * Session type already sitting on this day, when known — lets the
   * muscle-group spacing check tell an unrelated split (upper next to lower)
   * apart from a genuine same-group repeat. Left undefined for a taken day
   * whose type isn't known to the caller; that's treated conservatively (as
   * if it could overlap with anything) rather than assumed harmless.
   */
  takenType?: StrengthSessionType;
}

export interface Placement {
  key: string;
  type: StrengthSessionType;
}

const LOWER_TYPES = new Set<StrengthSessionType>(["lower", "lower_achilles"]);

/** Heaviest first — heavy sessions get first pick of the good days. */
const PLACEMENT_WEIGHT: Record<StrengthSessionType, number> = {
  lower_achilles: 5,
  lower: 4,
  full_body: 3,
  upper_achilles: 2,
  achilles: 1.5,
  upper: 1,
};

// ── Muscle-group overlap, derived from what each session actually trains ────
// The recovery constraint that matters is per muscle group (~48h for the
// same group), not "no strength on consecutive days" — an upper/lower split
// works fine on back-to-back days, which is why the flat adjacency penalty
// this used to be was wrong: it punished Mon lower → Tue upper exactly as
// hard as Mon lower → Tue lower.
//
// Groups must be derived from `sessionTemplateFor(type, complaints)` — the
// resolved slot list an athlete actually gets — not from the bare type, so a
// reported complaint's TARGETED_WORK addition (see program.ts) is accounted
// for the same way a hand-authored group table never could be. This function
// is only ever used for the STRENGTH rotation's own muscle-group spacing
// (placeStrengthWeek) — it doesn't know about Achilles/HSR attachment,
// because that's decided by a separate pass afterward, over the whole week,
// not per-neighbour-day muscle overlap (see reconcile.ts
// computeAchillesRehabDays and its own spacing rule). Deriving from the
// resolved template (program.ts + EXERCISE_BY_SLUG's primary muscle, the
// same catalogue exercise-search already uses) keeps this to one definition
// instead of a second, staler one.
function sessionMuscleGroups(type: StrengthSessionType, complaints: Complaint[]): Set<MuscleGroup> {
  const groups = new Set<MuscleGroup>();
  for (const slot of sessionTemplateFor(type, complaints).slots) {
    const exercise = EXERCISE_BY_SLUG[slot.exerciseSlug];
    if (!exercise) continue;
    // Only the primary muscle counts — see groupsOverlap below for why
    // secondary muscles are deliberately excluded.
    groups.add(muscleGroupFor(exercise.primaryMuscle));
  }
  return groups;
}

/**
 * Whether two session types (as this athlete's complaints actually shape
 * them) train any of the same muscle group.
 *
 * Only each exercise's *primary* muscle counts toward a session's group set.
 * Secondary muscles are real (a squat's core bracing, an overhead press's
 * core/triceps involvement) but including them made nearly every pair of
 * session types "overlap" via incidental Core/Back secondaries — exactly the
 * over-broad conflict this rule exists to avoid. Primary-only matches how a
 * coach actually reads a split: an upper day and a lower day don't compete
 * for the same recovery window just because both braced their core.
 */
function groupsOverlap(
  a: StrengthSessionType,
  b: StrengthSessionType,
  complaints: Complaint[]
): boolean {
  const ga = sessionMuscleGroups(a, complaints);
  const gb = sessionMuscleGroups(b, complaints);
  for (const g of ga) if (gb.has(g)) return true;
  return false;
}

/**
 * Genuine physiological conflict — never place here no matter what else is
 * available. Everything else (spacing, doubling with an easy run) is a
 * preference: it shapes *which* day wins, but on its own must never be able
 * to eliminate a session the athlete configured.
 */
export function isHardVeto(day: PlacementDay, type: StrengthSessionType): boolean {
  const isLower = LOWER_TYPES.has(type);
  const achillesBlock = hasAchillesBlock(type);
  const hardToday = day.runType != null && HARD_RUN_TYPES.has(day.runType);
  const longToday = day.runType === "long";
  // Hard run tomorrow (interval/tempo/race) vs. long run tomorrow are kept
  // separate on purpose — see below.
  const hardRunTomorrow = day.nextDayRunType != null && HARD_RUN_TYPES.has(day.nextDayRunType);
  const longRunTomorrow = day.nextDayRunType === "long";

  // Heavy legs on a hard/long run day, or the day before a hard/long run:
  // real pre-fatigue/interference risk, not just a bad fit.
  if ((hardToday || longToday) && isLower) return true;
  if ((hardRunTomorrow || longRunTomorrow) && isLower) return true;

  // Achilles/HSR work follows its own, narrower rules (constraints.ts top
  // comment): explosive step-ups and an interval run never share a day, and
  // the block sits off-limits the day before a genuinely hard run
  // (interval/tempo/race) — but a long EASY run the next day is explicitly
  // fine for HSR (it isn't heavy-leg strength work, so it doesn't carry the
  // same pre-fatigue-before-a-long-run risk). Vetoing it there too was
  // inherited from the isLower reasoning above without justification, and it
  // was blocking a legitimate rehab day (e.g. the day before Saturday's long
  // run) that the protocol never needed to avoid.
  if (achillesBlock && day.runType === "interval") return true;
  if (achillesBlock && hardRunTomorrow) return true;

  // Race day and the day before it are off-limits for every session type —
  // in practice the whole race week already carries zero strength sessions
  // (see reconcile.weekBudgetFor); this guards the edge case where race day
  // falls on a Monday and "the day before" sits in the previous calendar
  // week.
  if (day.runType === "race" || day.nextDayRunType === "race") return true;

  return false;
}

export function scorePlacement(
  day: PlacementDay,
  type: StrengthSessionType,
  /** Key of every already-occupied strength day (placed or pre-taken) mapped
   * to its session type, when known. */
  strengthDays: Map<string, StrengthSessionType | undefined>,
  allDays: PlacementDay[],
  complaints: Complaint[] = []
): number {
  let score = 0;
  const isLower = LOWER_TYPES.has(type);
  const achillesBlock = hasAchillesBlock(type);
  const hardToday = day.runType != null && HARD_RUN_TYPES.has(day.runType);
  const longToday = day.runType === "long";
  const hardRunTomorrow = day.nextDayRunType != null && HARD_RUN_TYPES.has(day.nextDayRunType);
  const longRunTomorrow = day.nextDayRunType === "long";
  const hardOrLongTomorrow = hardRunTomorrow || longRunTomorrow;

  // Same day as a hard/long run: heavy legs are a hard veto (see
  // isHardVeto); anything else is merely a poor fit.
  if (hardToday || longToday) score += isLower ? -100 : -30;
  // Day before a hard or long run: don't pre-fatigue the legs. Achilles/HSR
  // work only takes the same penalty for a genuinely hard run tomorrow, not
  // a long easy one — see isHardVeto for why those are kept separate.
  if (hardOrLongTomorrow) {
    if (isLower) score -= 70;
    else if (achillesBlock && hardRunTomorrow) score -= 70;
    else score -= 10;
  }
  // Doubling with any run costs a little even when it's easy.
  if (day.runType != null && !hardToday && !longToday) score += isLower ? -20 : -8;
  // A true rest day is the best home for strength.
  if (day.runType == null) score += 15;

  // Avoid a neighbouring strength day that trains the same muscle group —
  // Mon lower → Tue upper is fine and gets no penalty; Mon lower → Tue lower
  // (or → full_body, which overlaps almost everything) does — see
  // groupsOverlap.
  const idx = allDays.findIndex((d) => d.key === day.key);
  const prev = allDays[idx - 1];
  const next = allDays[idx + 1];
  const neighborConflicts = (key: string | undefined) => {
    if (key == null || !strengthDays.has(key)) return false;
    const neighborType = strengthDays.get(key);
    if (neighborType == null) return true; // unknown existing session — stay conservative
    return groupsOverlap(type, neighborType, complaints);
  };
  if (prev && neighborConflicts(prev.key)) score -= 30;
  if (next && neighborConflicts(next.key)) score -= 30;

  return score;
}

/**
 * Assign the rotation's session types to the week's candidate days.
 * `days` must cover the week in order (including non-candidate days so
 * adjacency is visible); candidates are the untaken entries whose `dow` is
 * in `availableDows`. `complaints` shapes which muscle groups each session
 * type actually trains (see sessionMuscleGroups) — pass the athlete's
 * reported complaints so a reported complaint's TARGETED_WORK addition is
 * accounted for in the spacing preference.
 */
export function placeStrengthWeek(
  days: PlacementDay[],
  availableDows: number[],
  rotation: StrengthSessionType[],
  complaints: Complaint[] = []
): Placement[] {
  const placements: Placement[] = [];
  const strengthDays = new Map<string, StrengthSessionType | undefined>(
    days.filter((d) => d.taken).map((d) => [d.key, d.takenType])
  );

  const types = [...rotation].sort(
    (a, b) => (PLACEMENT_WEIGHT[b] ?? 0) - (PLACEMENT_WEIGHT[a] ?? 0)
  );

  for (const type of types) {
    let best: { day: PlacementDay; score: number } | null = null;
    for (const day of days) {
      if (day.taken) continue;
      if (!availableDows.includes(day.dow)) continue;
      if (strengthDays.has(day.key)) continue;
      if (isHardVeto(day, type)) continue; // genuine conflict — never a candidate
      const score = scorePlacement(day, type, strengthDays, days, complaints);
      if (!best || score > best.score) best = { day, score };
    }
    // No veto-free day left this week — a real shortfall, not a preference
    // fight. Skip the slot; the caller surfaces this via shortWeeks.
    if (!best) continue;
    placements.push({ key: best.day.key, type });
    strengthDays.set(best.day.key, type);
  }

  // Present in calendar order regardless of placement priority.
  return placements.sort((a, b) => (a.key < b.key ? -1 : 1));
}

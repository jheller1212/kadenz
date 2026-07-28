// ── Duration fitting ──────────────────────────────────────────────────────────
//
// Makes the Kraft settings' session-length choice (30 / 45 / 60 min) real: it
// reshapes a full session plan so its estimated duration actually lands near
// the chosen budget, instead of the plan staying identical regardless of what
// was picked (which is what `strengthPlanSettings.durationMinutes` did before
// this module existed — stored and displayed, never consumed).
//
// Trim/grow order is priority-driven, not position-driven, because a naive
// "cut the tail" approach removes the wrong things: in upper_achilles and
// lower_achilles the Achilles/HSR block sits at (or near) the end of the slot
// array, and that block is exactly the work that must never be dropped.
//
//   1. Shrinking: drop whole "accessory" exercises first (isolation/finisher
//      work), then reduce set counts on what's left — primary compound lifts,
//      then "targeted" complaint-specific work (see program.ts
//      TARGETED_WORK), then flexible Achilles work — never the HSR-prescribed
//      sets (those follow `hsrPrescriptionForWeek`, a rehab protocol, not a
//      duration knob). "targeted" and "achilles" exercises are never dropped
//      whole — a reported complaint or the tendon programme is the reason the
//      session exists, not optional filler.
//   2. Growing: bump primary/accessory sets to a sensible working volume,
//      then — if there's still budget left — pull in extra exercises that
//      complement the session (see `pickComplementaryCandidate` below)
//      instead of continuing to pile sets onto what's already there. Only
//      once the candidate pool is exhausted does growth fall back to pushing
//      primary/accessory sets to their hard ceiling. "targeted" and
//      "achilles" work get a small bump to their own prescribed dose and
//      stop — a reported complaint or the tendon programme has a sensible
//      amount of work, not "however much time is left over" (that used to
//      make Achilles work balloon on long sessions — see MAX_SETS_TARGETED_
//      ACHILLES below). HSR-locked sets are never touched by any of this.
//
// Pure and DB-free: takes/returns plain exercise-shaped records so it's
// trivially unit-testable without touching session.ts's DB-aware wrapper.

import { estimateWorkoutDuration, type EstimatableSlot } from "./estimate";
import { muscleGroupFor } from "./muscle-groups";

export interface DurationFitExercise extends EstimatableSlot {
  slug: string;
  priority: "primary" | "accessory" | "achilles" | "targeted";
  /** True only for the week-based HSR calf raises — sets are never touched. */
  setsLocked: boolean;
  /** Primary muscle trained (ExerciseDef.primaryMuscle) — used to spread
   *  newly-added exercises across muscle groups instead of piling every one
   *  onto whatever's already best-represented (see pickComplementaryCandidate). */
  primaryMuscle?: string;
}

// A trimmed plan that's noticeably short of the budget looks like the length
// choice was ignored just as much as an oversized one — so we also fill up
// to a floor, not only cap the ceiling.
const DURATION_TOLERANCE = 0.8;

// "Sensible working volume" for primary/accessory work before growth reaches
// for a new exercise instead of another set — 4 working sets is already a
// full dose for a single dumbbell lift; past that, more variety serves the
// session better than more volume on the same movement.
const MAX_SETS_WORKING = 4;

// Hard ceiling for primary/accessory sets — only used once the candidate
// pool is exhausted (equipment-limited athlete, or every complementary
// exercise already in the plan) and there's still budget to fill.
const MAX_SETS_DEFAULT = 6;

// Complaint-targeted work and flexible Achilles work (explosive step-ups,
// toe walks — never the HSR-locked calf raises) have a prescribed dose: a
// small bump from their 3-set base, then they stop, regardless of how much
// budget is left. This is what actually fixes "longer session = mostly
// Achilles work" — that block used to be able to grow to 8 sets per exercise
// because it was the only lever left once primary/accessory hit their old
// cap; now it reaches its dose and growth moves on to new exercises instead.
const MAX_SETS_TARGETED_ACHILLES = 4;

// How many brand-new exercises growth may introduce in one session. Bounded
// so a long budget buys real variety, not an ever-growing exercise list.
const MAX_NEW_EXERCISES = 3;

// Floor for set-reduction — a compound lift or explosive Achilles exercise
// stops losing sets at 2; below that it's not really "the exercise" anymore.
const MIN_SETS = 2;

function estimate(list: DurationFitExercise[]): number {
  return estimateWorkoutDuration(list);
}

/** Index of the last remaining accessory exercise, or -1. */
function lastAccessoryIndex(list: DurationFitExercise[]): number {
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].priority === "accessory") return i;
  }
  return -1;
}

/**
 * Index of a reducible exercise: primary lifts before targeted (complaint)
 * work, before flexible Achilles work. Targeted work is protected the same
 * way Achilles work is — never dropped whole (see lastAccessoryIndex above),
 * only its set count flexes, and only once primary lifts are already at
 * their floor.
 */
function reducibleIndex(list: DurationFitExercise[]): number {
  for (const tier of ["primary", "targeted", "achilles"] as const) {
    const idx = list.findIndex(
      (e) => e.priority === tier && !e.setsLocked && e.sets > MIN_SETS
    );
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Exercises eligible for one more set in a given priority tier, ordered by
 * current set count ascending — growth spreads across the session instead of
 * piling every extra set onto a single lift. `cap` is the caller-chosen
 * ceiling for this pass (see MAX_SETS_WORKING vs MAX_SETS_DEFAULT vs
 * MAX_SETS_TARGETED_ACHILLES) — growth runs the working-volume pass before
 * the hard-ceiling pass, so the same tier can be visited twice with
 * different caps.
 */
function boostCandidates<T extends DurationFitExercise>(
  list: T[],
  tier: DurationFitExercise["priority"],
  cap: number
): T[] {
  return list
    .filter((e) => e.priority === tier && !e.setsLocked && e.sets < cap)
    .sort((a, b) => a.sets - b.sets);
}

/**
 * Grows every eligible exercise in `tier` one set at a time (round-robin,
 * lowest set count first) until the plan reaches `floorMinutes`, hits `cap`
 * on every exercise in the tier, or a further set would bust `targetMinutes`.
 * Returns the (possibly unchanged) list — callers reassign.
 */
function growTierSets<T extends DurationFitExercise>(
  list: T[],
  tier: DurationFitExercise["priority"],
  cap: number,
  floorMinutes: number,
  targetMinutes: number
): T[] {
  let progressed = true;
  while (estimate(list) < floorMinutes && progressed) {
    progressed = false;
    for (const candidate of boostCandidates(list, tier, cap)) {
      const idx = list.findIndex((e) => e === candidate);
      const trial = list.map((e, i) => (i === idx ? { ...e, sets: e.sets + 1 } : e));
      if (estimate(trial) > targetMinutes) continue; // would bust the budget — try the next candidate
      list = trial;
      progressed = true;
      break;
    }
  }
  return list;
}

/**
 * Picks the best new exercise to add from `candidates` (already
 * equipment/session-type filtered by the caller — see program.ts
 * growthCandidatesFor): whichever isn't already in `list` and whose muscle
 * group (see muscle-groups.ts) is *least* represented among what's already
 * planned. This is the "complement, don't pile on" rule — a press-heavy
 * Upper day (Shoulders + Chest already covered) reaches for a Back exercise
 * next, not a second Shoulders exercise. Ties keep the caller's ordering
 * (candidates is expected to be in a stable, deliberate order).
 */
function pickComplementaryCandidate<T extends DurationFitExercise>(
  list: DurationFitExercise[],
  candidates: T[]
): T | null {
  const present = new Set(list.map((e) => e.slug));
  const remaining = candidates.filter((c) => !present.has(c.slug));
  if (remaining.length === 0) return null;

  const groupCounts = new Map<string, number>();
  for (const e of list) {
    const group = muscleGroupFor(e.primaryMuscle);
    groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1);
  }

  let best = remaining[0];
  let bestCount = groupCounts.get(muscleGroupFor(best.primaryMuscle)) ?? 0;
  for (const c of remaining.slice(1)) {
    const count = groupCounts.get(muscleGroupFor(c.primaryMuscle)) ?? 0;
    if (count < bestCount) {
      best = c;
      bestCount = count;
    }
  }
  return best;
}

export interface DurationFitResult<T extends DurationFitExercise> {
  exercises: T[];
  estimatedMinutes: number;
}

/**
 * Reshape `exercises` (already at each slot's base prescription) so the
 * estimated duration fits `targetMinutes`: at or under the target, and not
 * more than ~20% under it. Returns a new array; input is not mutated.
 */
export function fitSessionToDuration<T extends DurationFitExercise>(
  exercises: T[],
  targetMinutes: number,
  /**
   * Extra exercises growth may introduce once what's already planned is at a
   * sensible working volume (see program.ts growthCandidatesFor for how
   * these are chosen — already equipment/session-type filtered, at their own
   * base prescription). Defaults to none, so every existing caller/test that
   * doesn't pass this keeps the old sets-only growth behaviour.
   */
  candidates: T[] = []
): DurationFitResult<T> {
  let list: T[] = exercises.map((e) => ({ ...e }));
  const floorMinutes = Math.max(1, Math.floor(targetMinutes * DURATION_TOLERANCE));

  // 1a. Over budget: drop accessory exercises whole, weakest (last) first.
  while (estimate(list) > targetMinutes) {
    const idx = lastAccessoryIndex(list);
    if (idx === -1) break;
    list = [...list.slice(0, idx), ...list.slice(idx + 1)];
  }

  // 1b. Still over: reduce sets — primary lifts before flexible Achilles
  // work, HSR-locked sets never touched, floor at MIN_SETS.
  while (estimate(list) > targetMinutes) {
    const idx = reducibleIndex(list);
    if (idx === -1) break; // nothing left to trim — accept best effort
    list[idx] = { ...list[idx], sets: list[idx].sets - 1 };
  }

  // 2a. Under the tolerance floor: bump primary/accessory to a sensible
  // working volume first (not the hard ceiling) — see MAX_SETS_WORKING.
  for (const tier of ["primary", "accessory"] as const) {
    list = growTierSets(list, tier, MAX_SETS_WORKING, floorMinutes, targetMinutes);
  }

  // 2b. Still under the floor and there's budget left: reach for a new,
  // complementary exercise instead of piling more sets onto what's already
  // there — this is what actually spends a longer session on more of the
  // session's own type (more Back on Upper, more Hamstrings on Lower, etc.)
  // rather than on whatever tier happened to have room left.
  let addedCount = 0;
  while (estimate(list) < floorMinutes && addedCount < MAX_NEW_EXERCISES) {
    const next = pickComplementaryCandidate(list, candidates);
    if (!next) break; // pool exhausted — fall through to 2c
    const trial = [...list, { ...next }];
    if (estimate(trial) > targetMinutes) break; // doesn't fit even at its base prescription
    list = trial;
    addedCount++;
  }

  // 2c. Still under the floor (equipment-limited athlete, or the candidate
  // pool ran out): push primary/accessory the rest of the way to their hard
  // ceiling — last resort, not the first one.
  for (const tier of ["primary", "accessory"] as const) {
    list = growTierSets(list, tier, MAX_SETS_DEFAULT, floorMinutes, targetMinutes);
  }

  // 2d. Complaint-targeted work and flexible Achilles work get a small bump
  // to their own prescribed dose and stop, regardless of remaining budget —
  // see MAX_SETS_TARGETED_ACHILLES. HSR-locked sets are excluded from
  // boostCandidates itself (setsLocked check) and never reached here.
  for (const tier of ["targeted", "achilles"] as const) {
    list = growTierSets(list, tier, MAX_SETS_TARGETED_ACHILLES, floorMinutes, targetMinutes);
  }

  return { exercises: list, estimatedMinutes: estimate(list) };
}

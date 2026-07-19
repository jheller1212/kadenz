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
//   2. Growing: add sets to primary lifts first, then accessories, then
//      targeted work, then flexible Achilles work — never past a sane
//      per-exercise cap, and never past the chosen budget itself.
//
// Pure and DB-free: takes/returns plain exercise-shaped records so it's
// trivially unit-testable without touching session.ts's DB-aware wrapper.

import { estimateWorkoutDuration, type EstimatableSlot } from "./estimate";

export interface DurationFitExercise extends EstimatableSlot {
  slug: string;
  priority: "primary" | "accessory" | "achilles" | "targeted";
  /** True only for the week-based HSR calf raises — sets are never touched. */
  setsLocked: boolean;
}

// A trimmed plan that's noticeably short of the budget looks like the length
// choice was ignored just as much as an oversized one — so we also fill up
// to a floor, not only cap the ceiling.
const DURATION_TOLERANCE = 0.8;

// Per-exercise set caps when growing a plan to fill a longer budget. Primary
// lifts and accessories cap lower (5–6 working sets is already a lot for a
// single dumbbell exercise); explosive/toe-walk Achilles work is lighter and
// can reasonably take more volume when it's the only lever left to pull (a
// pure Achilles day has just 2 flexible exercises against 2 locked ones).
const MAX_SETS_DEFAULT = 6;
const MAX_SETS_ACHILLES_FLEX = 8;

// Floor for set-reduction — a compound lift or explosive Achilles exercise
// stops losing sets at 2; below that it's not really "the exercise" anymore.
const MIN_SETS = 2;

function maxSetsFor(ex: DurationFitExercise): number {
  return ex.priority === "achilles" ? MAX_SETS_ACHILLES_FLEX : MAX_SETS_DEFAULT;
}

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
 * piling every extra set onto a single lift.
 */
function boostCandidates<T extends DurationFitExercise>(
  list: T[],
  tier: DurationFitExercise["priority"]
): T[] {
  return list
    .filter((e) => e.priority === tier && !e.setsLocked && e.sets < maxSetsFor(e))
    .sort((a, b) => a.sets - b.sets);
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
  targetMinutes: number
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

  // 2. Under the tolerance floor: grow sets — primary first, then
  // accessories still present, then flexible Achilles work — never past the
  // per-exercise cap and never past the budget itself.
  const tiers: DurationFitExercise["priority"][] = ["primary", "accessory", "targeted", "achilles"];
  for (const tier of tiers) {
    let progressed = true;
    while (estimate(list) < floorMinutes && progressed) {
      progressed = false;
      for (const candidate of boostCandidates(list, tier)) {
        const idx = list.findIndex((e) => e === candidate);
        const trial = list.map((e, i) => (i === idx ? { ...e, sets: e.sets + 1 } : e));
        if (estimate(trial) > targetMinutes) continue; // would bust the budget — try the next candidate
        list = trial;
        progressed = true;
        break;
      }
    }
  }

  return { exercises: list, estimatedMinutes: estimate(list) };
}

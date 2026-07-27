// Regenerating a plan (edit distance/pace/days) is a completely normal
// action, but the naive implementation deletes every week and reinserts a
// fresh schedule — which cascade-deletes every workout, including ones the
// athlete already ran, skipped, or was marked as missed. A "Mark complete"
// tap writes only to that workout row (no separate activity record for a
// non-GPS run), so once the row is gone that history is gone forever.
//
// The model here: a completed/skipped/missed workout is exempt from
// deletion entirely. Regeneration only ever replaces workouts that are still
// "planned". This keeps history exact (status, actualKm, rpe, the link to
// any backing activity — nothing about the row changes) at the cost of a
// schedule that can be part old, part new right after an edit. That trade
// is the honest one: the plan is being changed going forward, not the past.
//
// A week that holds at least one preserved workout can't be deleted outright
// (the FK would cascade the preserved workout away with it), so it's kept
// too. Any freshly generated workout that would land on the same calendar
// date as a preserved one is dropped instead of inserted, so a day is never
// double-booked between an old, real run and a new, planned one.

export interface PreservedWorkoutRef {
  weekNumber: number;
  date: Date;
}

export interface GeneratedWorkoutRef {
  weekNumber: number;
  date: Date;
}

export interface RegenerateMergePlan {
  /** Week numbers that must not be deleted because they hold preserved history. */
  retainedWeekNumbers: Set<number>;
  /** Generated week numbers that need a brand-new week row. */
  weekNumbersToInsert: number[];
  /** True if a freshly generated workout should actually be inserted. */
  keepGeneratedWorkout: (workout: GeneratedWorkoutRef) => boolean;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Decides which old weeks survive a regenerate and which newly generated
 * workouts collide with a preserved one on the same day. Pure and DB-free
 * so the merge logic itself is unit-testable — the caller does the actual
 * deletes/inserts.
 */
export function planRegenerateMerge(
  preserved: PreservedWorkoutRef[],
  generatedWeekNumbers: number[]
): RegenerateMergePlan {
  const retainedWeekNumbers = new Set(preserved.map((p) => p.weekNumber));
  const preservedDays = new Set(preserved.map((p) => dayKey(p.date)));

  const weekNumbersToInsert = generatedWeekNumbers.filter(
    (n) => !retainedWeekNumbers.has(n)
  );

  const keepGeneratedWorkout = (workout: GeneratedWorkoutRef): boolean =>
    !preservedDays.has(dayKey(workout.date));

  return { retainedWeekNumbers, weekNumbersToInsert, keepGeneratedWorkout };
}

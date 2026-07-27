// Pure rules for retiring a plan's sync artifacts. Kept DB- and network-free
// so the decision of "what needs pruning" is unit-testable — mirrors
// garmin-heal.ts's rowsNeedingRepush.

export interface RetireCandidateWorkout {
  id: string;
  gcalEventId: string | null;
  garminWorkoutId: string | null;
}

export interface RetireDeleteBatch {
  gcalDeletes: Array<{ workoutId: string; gcalEventId: string }>;
  garminDeletes: Array<{ workoutId: string; garminWorkoutId: string }>;
}

/**
 * Split workouts into the per-surface delete batches their non-null sync ids
 * require. Every workout with a stored id on a surface gets a delete queued
 * for that surface — a plan being replaced or archived must be pruned from
 * calendar AND watch, not just one.
 */
export function buildRetireDeleteBatch(rows: RetireCandidateWorkout[]): RetireDeleteBatch {
  return {
    gcalDeletes: rows
      .filter((r) => !!r.gcalEventId)
      .map((r) => ({ workoutId: r.id, gcalEventId: r.gcalEventId! })),
    garminDeletes: rows
      .filter((r) => !!r.garminWorkoutId)
      .map((r) => ({ workoutId: r.id, garminWorkoutId: r.garminWorkoutId! })),
  };
}

// Pure duration estimator for custom workouts — safe to import client-side.

export interface EstimatableSlot {
  sets: number;
  repLow: number;
  repHigh: number;
  restSeconds: number;
  /** Loaded per hand/leg — done sequentially, so it doubles the time cost. */
  perSide?: boolean;
}

// Simple heuristic: ~2 s per rep, plus 15 s setup per set, plus rest between sets.
// perSide work (e.g. single-leg RDL, one-arm row) is performed on each side in
// turn, so it takes roughly twice as long as a matched-pair set of the same
// prescription — without this, lower/lower_achilles/full_body estimates (which
// lean heavily on perSide accessories) undercount real session length.
export function estimateWorkoutDuration(slots: EstimatableSlot[]): number {
  let totalSeconds = 0;

  for (const slot of slots) {
    const effectiveSets = slot.perSide ? slot.sets * 2 : slot.sets;
    const avgReps = Math.ceil((slot.repLow + slot.repHigh) / 2);
    const secondsPerSet = 15 + avgReps * 2;
    totalSeconds +=
      secondsPerSet * effectiveSets +
      slot.restSeconds * Math.max(0, effectiveSets - 1);
  }

  return Math.ceil(totalSeconds / 60);
}

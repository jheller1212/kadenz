// Pure duration estimator for custom workouts — safe to import client-side.

export interface EstimatableSlot {
  sets: number;
  repLow: number;
  repHigh: number;
  restSeconds: number;
}

// Simple heuristic: ~2 s per rep, plus 15 s setup per set, plus rest between sets.
export function estimateWorkoutDuration(slots: EstimatableSlot[]): number {
  let totalSeconds = 0;

  for (const slot of slots) {
    const avgReps = Math.ceil((slot.repLow + slot.repHigh) / 2);
    const secondsPerSet = 15 + avgReps * 2;
    totalSeconds +=
      secondsPerSet * slot.sets + slot.restSeconds * Math.max(0, slot.sets - 1);
  }

  return Math.ceil(totalSeconds / 60);
}

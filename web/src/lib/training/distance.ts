// Shared rule for "how far did this run actually cover" — the recorded
// distance when there is one, falling back to the planned distance only for
// workouts that never got a real number attached. An exact match between
// actualKm and targetKm essentially never happens, so any screen that reads
// targetKm off a completed workout instead of this will disagree with every
// other screen on almost every run. Today's mileage ring and the Insights
// tab already did this right; the Plan hub didn't, hence this helper.
//
// Relative import, not "@/" — there is no vitest config in this repo, so the
// alias does not resolve under the test runner (see training/session.ts).

export interface RunDistanceRow {
  actualKm?: number | null;
  targetKm?: number | null;
}

/** Distance to credit a single workout toward "completed" totals. */
export function completedDistanceKm(workout: RunDistanceRow): number {
  return workout.actualKm ?? workout.targetKm ?? 0;
}

/** Sum of `completedDistanceKm` across a set of completed, non-rest runs. */
export function sumCompletedDistanceKm(
  runs: Array<RunDistanceRow & { status?: string; type?: string }>
): number {
  return runs
    .filter((r) => r.status === "completed" && r.type !== "rest")
    .reduce((sum, r) => sum + completedDistanceKm(r), 0);
}

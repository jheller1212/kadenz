// ── Guided-run recording — completion rule ────────────────────────────────────
// Recording GPS data (POST /api/workouts/[workoutId]/record) is the finish
// line for an ordinary run, but not for a race: the athlete still has to log
// a deliberate result (POST /api/workouts/[workoutId]/race-result), because
// GPS elapsed time isn't necessarily the official gun/chip time, and closing
// out a race-intent plan is that endpoint's job alone. Marking "completed"
// here for a race would let the athlete dismiss the result sheet with the
// workout already server-side done, no raceFinishSeconds, and the plan never
// closed. See src/app/api/workouts/[workoutId]/record/route.ts.

/** True when recording GPS data should, by itself, mark the workout complete. */
export function completesOnRecord(workoutType: string): boolean {
  return workoutType !== "race";
}

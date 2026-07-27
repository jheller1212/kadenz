// ── Workout match selection (pure) ───────────────────────────────────────────
// No DB imports here: this is the selection half of strava-client.ts's
// findMatchingWorkout, split out so it stays unit-testable without a database
// (same pattern as garmin-import.ts).

export interface WorkoutMatchCandidate {
  id: string;
  status: string;
  targetKm: number | null;
}

/**
 * Pure selection: given same-day workout candidates and the set of workout
 * ids already backed by a recorded activity (from ANY source — Strava or
 * Garmin), pick the best open match for a distance.
 *
 * "Already linked" must not mean "has stravaActivityId": Garmin's importRun
 * completes a workout by setting status/actualKm only, so a workout finished
 * via a Garmin import still needs excluding here or a later Strava upload of
 * the same run re-links it and overwrites actualKm.
 *
 * Planned workouts win over manually-completed ones that lack a recorded
 * activity; ties break on targetKm closest to the actual distance so
 * multi-run days attach to the right session.
 */
export function pickWorkoutMatch(
  candidates: WorkoutMatchCandidate[],
  linkedWorkoutIds: Set<string>,
  distanceKm: number
): string | null {
  const open = candidates.filter((c) => !linkedWorkoutIds.has(c.id));
  if (open.length === 0) return null;

  const byDistance = (pool: WorkoutMatchCandidate[]) =>
    [...pool].sort(
      (a, b) =>
        Math.abs((a.targetKm ?? 0) - distanceKm) -
        Math.abs((b.targetKm ?? 0) - distanceKm)
    )[0];

  const planned = open.filter((c) => c.status === "planned");
  const best = planned.length > 0 ? byDistance(planned) : byDistance(open);
  return best?.id ?? null;
}

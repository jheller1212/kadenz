// Pure rules for self-healing the Garmin push. Kept DB- and network-free so
// the decisions are unit-testable.

export interface TrackedRow {
  id: string;
  garminWorkoutId: string | null;
}

/**
 * Rows whose Garmin workout has disappeared (deleted on Garmin's side, by
 * another app, or by a user cleaning up). Their stored id is stale: clearing
 * it lets the normal window push re-create the workout.
 *
 * Repair is always additive — we re-create what is missing and never delete
 * to make the two sides agree.
 */
export function rowsNeedingRepush(
  rows: TrackedRow[],
  idsOnGarmin: Set<string>
): string[] {
  return rows
    .filter((r) => r.garminWorkoutId !== null && !idsOnGarmin.has(r.garminWorkoutId))
    .map((r) => r.id);
}

/**
 * Kadenz-created workouts on Garmin that no row references any more — the
 * duplicates left by the old move bug. Only ever computed over workouts
 * carrying our tag; anything another app created is invisible here.
 */
export function ourOrphanIds(
  ours: Array<{ garminWorkoutId: string; createdByKadenz: boolean }>,
  trackedIds: Set<string>
): string[] {
  return ours
    .filter((w) => w.createdByKadenz && !trackedIds.has(w.garminWorkoutId))
    .map((w) => w.garminWorkoutId);
}

/**
 * True when the worker's listing may not be the whole account: it returned
 * as many rows as the page limit allowed, so anything past that page is
 * invisible to this call. A workout absent from a partial page looks
 * "untracked" for the same reason a workout absent from a full page does —
 * there's no way to tell those two cases apart without listing further
 * pages, so a caller MUST refuse to delete when this is true rather than
 * treat a partial view as the complete account.
 */
export function isListingPossiblyPartial(count: number, limit: number): boolean {
  return count >= limit;
}

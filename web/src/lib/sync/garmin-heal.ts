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

/** The subset of GarminWorkoutSummary the adoption match needs — kept
 *  narrow so this file stays network- and type-import-free. */
export interface AdoptionCandidate {
  garminWorkoutId: string;
  name: string | null;
  createdByKadenz: boolean;
  scheduledDates: string[];
}

/**
 * Find a workout already on Garmin that matches a create job about to be
 * sent, so the push can adopt its id instead of creating a duplicate.
 *
 * This exists for one narrow window: Garmin's create call succeeds but the
 * write of the returned id back onto our row fails or the process dies
 * before it runs. The row still has garminWorkoutId = null, so it reads as
 * "never pushed" and the outbox retry (or the next day's window sync) tries
 * to create it again. Before creating, check whether the exact workout we
 * are about to send already exists — if so, adopt its id instead.
 *
 * The match key is (title, scheduled date) plus two safety conditions:
 *   - createdByKadenz — never adopt a workout Jonas made by hand or that
 *     another app created; the Kadenz tag on the description is the only
 *     signal that a Garmin workout is "ours" to begin with.
 *   - not already in trackedIds — never steal an id another row already
 *     owns. trackedIds must be every non-null garminWorkoutId across BOTH
 *     workouts and strengthSessions, read in the same drain this runs in,
 *     the same exclusion rule ourOrphanIds uses for reconcile.
 * Title equality is exact string equality against garminLabel's output —
 * the caller must pass the SAME title string it is about to send, not a
 * re-derivation, or the match silently stops firing when the two drift.
 *
 * A miss here does not prove the workout is absent — see
 * isListingPossiblyPartial. The caller's fallback for a miss is always
 * "create", which reproduces today's (pre-fix) behaviour, so a false miss
 * is no worse than not having this check at all.
 */
export function findAdoptionCandidate(
  listing: AdoptionCandidate[],
  trackedIds: Set<string>,
  title: string,
  scheduledDate: string
): string | null {
  const match = listing.find(
    (w) =>
      w.createdByKadenz &&
      !trackedIds.has(w.garminWorkoutId) &&
      w.name === title &&
      w.scheduledDates.includes(scheduledDate)
  );
  return match ? match.garminWorkoutId : null;
}

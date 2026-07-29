// ── Garmin create-job adoption wiring ────────────────────────────────────────
// Split out of garmin-sync.ts (which was already over the file's line budget)
// to keep the outbox drain readable. This module owns building the per-drain
// "what's already on Garmin" context and claiming candidates from it; it has
// no knowledge of outbox jobs, workouts, or strength sessions. The actual
// matching rule stays pure and DB-free in garmin-heal.ts.
//
// Why this exists: if Garmin's create call succeeds but the write of the
// returned id back onto our row fails or the process dies before it runs,
// the row still reads "never pushed" and a retry (or the next window sync)
// would create the same workout again — a duplicate on the watch
// (PLAN_OF_ATTACK.md §4). Before creating, check whether the exact workout
// we're about to send already exists under our tag and adopt its id instead.

import { db, workouts, strengthSessions } from "@/db";
import { isNotNull } from "drizzle-orm";
import { garminClient } from "./garmin-client";
import type { GarminWorkoutSummary } from "./garmin-client";
import { findAdoptionCandidate, isListingPossiblyPartial } from "./garmin-heal";

// The worker's own hard cap on GET /workouts (see garmin-worker/main.py) — also
// used by /api/sync/reconcile-garmin's LIST_LIMIT.
const ADOPTION_LISTING_LIMIT = 500;

/**
 * Everything a create job needs to check "does this already exist on
 * Garmin?" before pushing a new one — built at most once per drain.
 *
 * `trackedIds` is mutated in place over the course of the drain (via
 * claimAdoptionCandidate and markGarminIdClaimed) as jobs consume
 * candidates or create fresh ones. That mutation is load-bearing: two
 * create jobs in the same claimed batch that build the identical
 * (title, scheduledDate) — e.g. a retried job still sitting pending
 * alongside its own re-enqueue — would otherwise both match the SAME
 * remote workout and both local rows would end up pointing at one Garmin
 * id, which is a worse, silent failure than the duplicate this whole
 * mechanism exists to prevent.
 */
export interface AdoptionContext {
  listing: GarminWorkoutSummary[];
  trackedIds: Set<string>;
  isPartial: boolean;
}

/**
 * Read the account's current workouts plus every id Kadenz already tracks,
 * once, so every create job in this drain can check for an adoption
 * candidate without a listing call each. Mirrors the tracked-id build in
 * /api/sync/reconcile-garmin (both non-null garminWorkoutId columns).
 */
export async function buildAdoptionContext(): Promise<AdoptionContext> {
  const [listing, runTracked, strengthTracked] = await Promise.all([
    garminClient.listWorkouts(ADOPTION_LISTING_LIMIT, true),
    db
      .select({ garminWorkoutId: workouts.garminWorkoutId })
      .from(workouts)
      .where(isNotNull(workouts.garminWorkoutId)),
    db
      .select({ garminWorkoutId: strengthSessions.garminWorkoutId })
      .from(strengthSessions)
      .where(isNotNull(strengthSessions.garminWorkoutId)),
  ]);

  const trackedIds = new Set<string>();
  for (const r of [...runTracked, ...strengthTracked]) {
    if (r.garminWorkoutId) trackedIds.add(r.garminWorkoutId);
  }

  return {
    listing,
    trackedIds,
    // A listing capped at the worker's page limit cannot prove a workout is
    // absent — see isListingPossiblyPartial. That's fine here: unlike
    // reconcile (which deletes on a miss), a create-job miss just falls
    // through to creating, which is exactly today's pre-fix behaviour and
    // no worse. isPartial is carried through only so a match/no-match can be
    // logged honestly, not to change what happens on a miss.
    isPartial: isListingPossiblyPartial(listing.length, ADOPTION_LISTING_LIMIT),
  };
}

/**
 * Look for a Garmin workout matching (title, scheduledDate) and, if found,
 * immediately claim it by adding its id to `adoption.trackedIds`.
 *
 * The claim is the point: call this exactly once per job, right before
 * deciding whether to create, so a second job later in the same drain that
 * would otherwise match the identical candidate sees it as already tracked
 * and falls through to creating its own workout instead of adopting the
 * same one a sibling job just claimed.
 */
export function claimAdoptionCandidate(
  adoption: AdoptionContext,
  title: string,
  scheduledDate: string
): string | null {
  const id = findAdoptionCandidate(adoption.listing, adoption.trackedIds, title, scheduledDate);
  if (id) adoption.trackedIds.add(id);
  return id;
}

/**
 * Record a freshly created workout's id as tracked. A brand-new id can't
 * appear in `listing` (the listing was read before the create happened) so
 * this can't change any match outcome within the drain — it's here purely
 * to keep "trackedIds is authoritative for this drain" true as an
 * invariant, rather than relying on callers reasoning about why it's safe
 * to skip.
 */
export function markGarminIdClaimed(adoption: AdoptionContext, garminWorkoutId: string): void {
  adoption.trackedIds.add(garminWorkoutId);
}

/**
 * The adopt-or-create decision itself: try to claim an existing match, and
 * only call `create` on a miss. Shared by the run push and the strength
 * push in garmin-sync.ts so the two can't drift on how they wire adoption.
 * `adoption` is null on a drain with no create jobs at all — callers pass
 * that straight through rather than special-casing it themselves.
 */
export async function resolveGarminWorkoutId(
  adoption: AdoptionContext | null,
  title: string,
  scheduledDate: string,
  create: () => Promise<string>
): Promise<string> {
  const adopted = adoption ? claimAdoptionCandidate(adoption, title, scheduledDate) : null;
  if (adopted) return adopted;
  const garminWorkoutId = await create();
  if (adoption) markGarminIdClaimed(adoption, garminWorkoutId);
  return garminWorkoutId;
}

/**
 * Write a resolved Garmin id back onto the owning row, logging loudly and
 * rethrowing on failure instead of swallowing it. The workout already
 * exists on Garmin (created or adopted) at this point — losing the id write
 * is exactly the partial-failure window this whole module exists to close,
 * so the id goes into the log for manual recovery and the job is left to
 * fail and retry, which re-lists Garmin and adopts on the next pass instead
 * of creating a second copy.
 */
export async function writeBackGarminId(
  write: () => Promise<void>,
  garminWorkoutId: string,
  entityLabel: string
): Promise<void> {
  try {
    await write();
  } catch (err) {
    console.error(
      `Garmin workout ${garminWorkoutId} exists for ${entityLabel} but the id write failed; retry will adopt it`,
      err
    );
    throw err;
  }
}

// A logged race result is, among other things, evidence of a personal
// record. personal_records already exists and already drives the VDOT
// estimate shown in pace insights (see pace-insights/route.ts and
// current-fitness.ts) — this module is the one place a race result turns
// into a personal_records row, so that write doesn't get reinvented (with
// its own, possibly diverging, "is this a PR" rule) wherever a race result
// gets logged.

import { and, eq } from "drizzle-orm";
import { db, personalRecords } from "@/db";
import { ownedBy } from "@/lib/api/owned";
import { currentUserId } from "@/db/with-user";

/** personal_records only has buckets for the standard race distances — see
 *  prDistanceEnum in db/schema.ts. */
export type PrDistance = "5k" | "10k" | "half" | "marathon" | "mile";

const RACE_DISTANCE_TO_PR_BUCKET: Partial<Record<string, PrDistance>> = {
  "5k": "5k",
  "10k": "10k",
  half: "half",
  marathon: "marathon",
};

/**
 * Which personal_records bucket (if any) a plan's race distance maps to.
 * "ultra" and "custom" have no standard bucket to compare a time against —
 * a race at either distance still feeds the athlete's current-fitness VDOT
 * estimate (getCurrentFitnessEstimate reads workouts.raceFinishSeconds
 * directly, no bucket needed for that), it just doesn't get its own PR row.
 */
export function pickPrDistance(raceDistance: string): PrDistance | null {
  return RACE_DISTANCE_TO_PR_BUCKET[raceDistance] ?? null;
}

/**
 * Whether `candidateSeconds` is a new personal best against whatever is
 * already on file (or the first time on file at all). A logged race only
 * ever tightens a PR — a slower day at a distance already run faster must
 * not quietly erase the real best.
 */
export function isNewPersonalRecord(
  existingSeconds: number | null,
  candidateSeconds: number
): boolean {
  return existingSeconds == null || candidateSeconds < existingSeconds;
}

/**
 * Upserts the caller's personal_records row for a logged race result — the
 * same one-row-per-distance-per-athlete model POST /api/race-times uses for
 * a manually entered time, so a race result is just another way that row
 * gets set, not a parallel table with its own rules. No-op if the result
 * isn't actually a new best (see isNewPersonalRecord).
 *
 * Best-effort by design: called from the race-result route, which must not
 * fail the result log itself over a PR-bookkeeping problem.
 */
export async function recordRaceResultAsPersonalRecord(
  distance: PrDistance,
  timeSeconds: number,
  date: Date
): Promise<void> {
  const userId = currentUserId();

  const [existing] = await db
    .select({ id: personalRecords.id, timeSeconds: personalRecords.timeSeconds })
    .from(personalRecords)
    .where(and(ownedBy(personalRecords), eq(personalRecords.distance, distance)))
    .limit(1);

  if (!isNewPersonalRecord(existing?.timeSeconds ?? null, timeSeconds)) return;

  if (existing) {
    await db
      .update(personalRecords)
      .set({ timeSeconds, date, source: "race" })
      .where(and(ownedBy(personalRecords), eq(personalRecords.id, existing.id)));
  } else {
    await db.insert(personalRecords).values({
      userId,
      distance,
      timeSeconds,
      date,
      source: "race",
    });
  }
}

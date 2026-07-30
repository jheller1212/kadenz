// ── Garmin activity import (DB-backed runner) ────────────────────────────────
// Pulls recent activities from the garmin-worker, dedupes against rows that
// already arrived via Strava, stores new runs (with splits) and strength
// sessions, and auto-ticks the matching planned workout/session — mirroring
// strava-client's processActivity.

import { db, activities, workouts, strengthSessions, deletedActivities } from "@/db";
import { eq, and, gte, lte } from "drizzle-orm";
import { garminClient, type GarminActivity } from "./garmin-client";
import {
  isDuplicateActivity,
  mapGarminSplits,
  normalizeLocalTimestamp,
  parseGmtTimestamp,
} from "./garmin-import";
import { loadImportSince, saveImportTimestamp } from "./garmin-config";
import {
  findMatchingWorkout,
  findMatchingStrengthSession,
} from "./strava-client";
import { isConnected as isGcalConnected } from "./gcal-client";
import { queueStrengthSessionSync } from "./sync-manager";
import { buildProviderExternalId } from "@/lib/activity-provider";

const MIN_STRENGTH_MATCH_SECONDS = 5 * 60; // same guard as the Strava path
const DEDUPE_WINDOW_MS = 10 * 60 * 1000;

export interface GarminImportResult {
  fetched: number;
  imported: number;
  skippedDuplicates: number;
  skippedOther: number;
  skippedDeleted: number;
}

/** Tombstone key for Garmin-origin activities in deleted_activities (which is
 * keyed by strava_id) — namespaced so it can never collide with a Strava id. */
export function garminTombstoneKey(garminId: string): string {
  return `garmin:${garminId}`;
}

async function isDuplicate(act: GarminActivity, startDate: Date): Promise<boolean> {
  // Same run arriving via Strava: startDate within ±10 min AND duration ±15%.
  const nearby = await db
    .select({
      startDate: activities.startDate,
      durationSeconds: activities.durationSeconds,
    })
    .from(activities)
    .where(
      and(
        gte(activities.startDate, new Date(startDate.getTime() - DEDUPE_WINDOW_MS)),
        lte(activities.startDate, new Date(startDate.getTime() + DEDUPE_WINDOW_MS))
      )
    );
  return isDuplicateActivity(
    { startDate, durationSeconds: act.durationSeconds },
    nearby
  );
}

async function importRun(userId: string, act: GarminActivity, startDate: Date): Promise<void> {
  // Fetch detail for splits; a failed detail fetch shouldn't lose the activity.
  let splitsJson: unknown[] | null = null;
  try {
    const detail = await garminClient.getActivity(act.garminId);
    if (detail.splits?.length) splitsJson = mapGarminSplits(detail.splits);
  } catch (err) {
    console.error(`Garmin detail fetch failed for ${act.garminId}:`, err);
  }

  const distanceKm = act.distanceMeters != null ? act.distanceMeters / 1000 : null;
  const workoutId = await findMatchingWorkout({
    start_date_local: normalizeLocalTimestamp(act.startTimeLocal),
    distance: act.distanceMeters ?? 0,
  });

  await db.insert(activities).values({
    workoutId,
    userId,
    garminId: act.garminId,
    ...buildProviderExternalId("garmin", act.garminId),
    sportType: "Run",
    name: act.name,
    startDate,
    distanceKm,
    // Garmin returns these as floats (e.g. durationSeconds 2297.51); the columns
    // are integers, so round before insert or the whole import 500s.
    durationSeconds: act.durationSeconds != null ? Math.round(act.durationSeconds) : null,
    avgPaceSecKm: act.avgPaceSecPerKm != null ? Math.round(act.avgPaceSecPerKm) : null,
    avgHr: act.avgHr != null ? Math.round(act.avgHr) : null,
    maxHr: act.maxHr != null ? Math.round(act.maxHr) : null,
    elevationGain: act.elevationGain != null ? Math.round(act.elevationGain) : null,
    splitsJson,
  });

  if (workoutId) {
    await db
      .update(workouts)
      .set({ status: "completed", actualKm: distanceKm, updatedAt: new Date() })
      .where(eq(workouts.id, workoutId));
  }
}

async function importStrength(userId: string, act: GarminActivity, startDate: Date): Promise<void> {
  const longEnough = (act.durationSeconds ?? 0) >= MIN_STRENGTH_MATCH_SECONDS;
  const strengthSessionId = longEnough
    ? await findMatchingStrengthSession({
        start_date_local: normalizeLocalTimestamp(act.startTimeLocal),
        moving_time: act.durationSeconds ?? 0,
      })
    : null;

  await db.insert(activities).values({
    strengthSessionId,
    userId,
    garminId: act.garminId,
    ...buildProviderExternalId("garmin", act.garminId),
    sportType: act.activityType || "WeightTraining",
    name: act.name,
    startDate,
    // Round the float duration — integer column (see importRun).
    durationSeconds: act.durationSeconds != null ? Math.round(act.durationSeconds) : null,
    avgHr: act.avgHr != null ? Math.round(act.avgHr) : null,
    maxHr: act.maxHr != null ? Math.round(act.maxHr) : null,
  });

  if (strengthSessionId) {
    // Same auto-complete + calendar cleanup as the Strava path.
    const [sess] = await db
      .select({ gcalEventId: strengthSessions.gcalEventId })
      .from(strengthSessions)
      .where(eq(strengthSessions.id, strengthSessionId));

    await db
      .update(strengthSessions)
      .set({
        status: "completed",
        durationMinutes: act.durationSeconds
          ? Math.max(1, Math.round(act.durationSeconds / 60))
          : null,
        gcalEventId: null,
        updatedAt: new Date(),
      })
      .where(eq(strengthSessions.id, strengthSessionId));

    if (sess?.gcalEventId) {
      isGcalConnected(userId)
        .then((connected) => {
          if (connected) {
            return queueStrengthSessionSync(strengthSessionId, "delete", userId, "gcal", {
              gcalEventId: sess.gcalEventId,
            });
          }
        })
        .catch((err) => console.error("Failed to queue strength calendar cleanup:", err));
    }
  }
}

/**
 * Pull recent activities from the (single, installation-level) Garmin
 * worker and store them under the given userId. Every insert this makes
 * (activities) carries that id explicitly rather than relying on the
 * activities table's user_id default, which is the owner. Today the only
 * caller of this is the owner's own cron iteration, but requiring the id
 * as a real parameter means that stays true by construction rather than by
 * coincidence if a caller ever changes.
 */
export async function runGarminImport(userId: string): Promise<GarminImportResult> {
  const result: GarminImportResult = {
    fetched: 0,
    imported: 0,
    skippedDuplicates: 0,
    skippedOther: 0,
    skippedDeleted: 0,
  };

  const since = await loadImportSince(userId);
  const importStartedAt = new Date();
  const acts = await garminClient.listActivities(since.toISOString(), 200);
  result.fetched = acts.length;

  for (const act of acts) {
    if (act.kind !== "run" && act.kind !== "strength") {
      result.skippedOther++;
      continue;
    }

    // Never resurrect an activity the user deleted in Kadenz.
    const [tombstone] = await db
      .select({ stravaId: deletedActivities.stravaId })
      .from(deletedActivities)
      .where(eq(deletedActivities.stravaId, garminTombstoneKey(act.garminId)))
      .limit(1);
    if (tombstone) {
      result.skippedDeleted++;
      continue;
    }

    // Already imported from Garmin.
    const [existing] = await db
      .select({ id: activities.id })
      .from(activities)
      .where(eq(activities.garminId, act.garminId))
      .limit(1);
    if (existing) {
      result.skippedDuplicates++;
      continue;
    }

    const startDate = parseGmtTimestamp(act.startTimeGMT);
    if (Number.isNaN(startDate.getTime())) {
      result.skippedOther++;
      continue;
    }

    // Same activity already here via Strava.
    if (await isDuplicate(act, startDate)) {
      result.skippedDuplicates++;
      continue;
    }

    // One malformed activity must not abort the whole import (it used to 500
    // the entire run, so nothing imported). Log and skip the bad one.
    try {
      if (act.kind === "run") {
        await importRun(userId, act, startDate);
      } else {
        await importStrength(userId, act, startDate);
      }
      result.imported++;
    } catch (err) {
      console.error(`Garmin import: failed to store activity ${act.garminId}:`, err);
      result.skippedOther++;
    }
  }

  await saveImportTimestamp(userId, importStartedAt);
  return result;
}

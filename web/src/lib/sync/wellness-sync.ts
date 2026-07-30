// ── Garmin wellness sync (DB-backed runner) ───────────────────────────────────
// Pulls overnight physiology (sleep, resting HR, HRV) from the garmin-worker
// and upserts it into wellness_metrics, one row per calendar day. Runs from
// the same once-daily cron as the activity import (see api/cron/gcal) — a
// daily pull is enough for numbers that only change once per night.
//
// Backfills rather than only pulling "yesterday": the watch already has
// weeks of history the moment this ships, and the readiness baseline (see
// lib/physiology.ts) needs that history to leave warm-up. Capped per run so
// a first deploy doesn't fire dozens of worker calls in one cron tick; it
// converges over a few days, newest-missing-first so the 7-day recent
// average is complete before the older baseline tail fills in.

import { and, eq, gte, lt } from "drizzle-orm";
import { db, wellnessMetrics } from "@/db";
import { garminClient } from "./garmin-client";
import { toGarminDate } from "./garmin-client";

const BACKFILL_WINDOW_DAYS = 60;
const MAX_PULLS_PER_RUN = 8;

export interface WellnessSyncResult {
  pulled: number;
  missing: number;
  failed: number;
}

function dayStart(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function dateKey(d: Date): string {
  return toGarminDate(d);
}

/**
 * Pull overnight physiology from the (single, installation-level) Garmin
 * worker for the given userId. Garmin isn't per-user OAuth, only the owner
 * ever resolves to a watch, but wellness_metrics is a real per-row-owned
 * table, and the `existing` query below is scoped to that userId's own rows
 * for the same reason garmin-config.ts keys its state by id: unscoped, a
 * caller iterating multiple ids would read one iteration's collected nights
 * as proof that another iteration's nights are collected too, and silently
 * never backfill them. No error and no empty screen, just a readiness
 * baseline stuck in its 21-night warm-up with no visible cause.
 */
export async function runWellnessSync(userId: string): Promise<WellnessSyncResult> {
  if (!garminClient.isConfigured()) {
    return { pulled: 0, missing: 0, failed: 0 };
  }

  const today = dayStart(new Date());
  const windowStart = new Date(today.getTime() - BACKFILL_WINDOW_DAYS * 24 * 3600_000);

  // Garmin rows only — a row from another source (Apple Health, Health
  // Connect) on the same date must not suppress this pull. wellness_metrics
  // is unique on (source, date), not date alone, so each source tracks its
  // own "have I already got this night" independently.
  const existing = await db
    .select({ date: wellnessMetrics.date })
    .from(wellnessMetrics)
    .where(
      and(
        eq(wellnessMetrics.source, "garmin"),
        eq(wellnessMetrics.userId, userId),
        gte(wellnessMetrics.date, windowStart),
        lt(wellnessMetrics.date, today)
      )
    );
  const existingKeys = new Set(existing.map((e) => dateKey(e.date)));

  // Candidate days: yesterday back to the start of the window. Today is
  // deliberately excluded — overnight metrics for "today" aren't final until
  // the athlete wakes up and the watch syncs, so pulling it early would
  // silently miss data (or worse, cache a partial reading forever, since the
  // upsert below never re-pulls a day already present).
  const candidates: Date[] = [];
  for (let i = 1; i <= BACKFILL_WINDOW_DAYS; i++) {
    const d = new Date(today.getTime() - i * 24 * 3600_000);
    if (!existingKeys.has(dateKey(d))) candidates.push(d);
  }
  // Newest missing first: the recent window matters more for the rolling
  // 7-day average than a gap deep in the baseline tail.
  candidates.sort((a, b) => b.getTime() - a.getTime());

  const toPull = candidates.slice(0, MAX_PULLS_PER_RUN);
  let pulled = 0;
  let failed = 0;

  for (const day of toPull) {
    try {
      const w = await garminClient.getWellness(dateKey(day));
      await db
        .insert(wellnessMetrics)
        .values({
          date: day,
          sleepSeconds: w.sleepSeconds,
          restingHr: w.restingHr,
          hrvLastNightAvg: w.hrvLastNightAvg,
          hrvWeeklyAvg: w.hrvWeeklyAvg,
          hrvStatus: w.hrvStatus,
          source: "garmin",
          userId,
        })
        // NOTE: the unique constraint this targets is still (source, date),
        // not (user_id, source, date). See the userId column comment on
        // wellnessMetrics in schema.ts. Two users' Garmin pulls landing on
        // the same calendar date will still collide at the DB layer, upsert
        // this row into each other's, regardless of the userId this function
        // scopes its reads and writes by. Widening the constraint is a
        // migration, out of scope here; flagged, not fixed.
        .onConflictDoUpdate({
          target: [wellnessMetrics.source, wellnessMetrics.date],
          set: {
            sleepSeconds: w.sleepSeconds,
            restingHr: w.restingHr,
            hrvLastNightAvg: w.hrvLastNightAvg,
            hrvWeeklyAvg: w.hrvWeeklyAvg,
            hrvStatus: w.hrvStatus,
            source: "garmin",
            userId,
            updatedAt: new Date(),
          },
        });
      pulled++;
    } catch (err) {
      // One bad day (worker hiccup, Garmin down) must not stop the rest of
      // the backfill — it just gets retried on the next cron tick since it's
      // still "missing" from wellness_metrics.
      console.error(`Wellness sync: failed to pull ${dateKey(day)}:`, err);
      failed++;
    }
  }

  return { pulled, missing: candidates.length, failed };
}

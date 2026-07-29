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

export async function runWellnessSync(): Promise<WellnessSyncResult> {
  if (!garminClient.isConfigured()) {
    return { pulled: 0, missing: 0, failed: 0 };
  }

  const today = dayStart(new Date());
  const windowStart = new Date(today.getTime() - BACKFILL_WINDOW_DAYS * 24 * 3600_000);

  // Garmin rows only — a row from another source (Apple Health, Health
  // Connect) on the same date must not suppress this pull. wellness_metrics
  // is now unique on (source, date), not date alone, so each source tracks
  // its own "have I already got this night" independently.
  // Phase 3 must add the user filter here. This asks "which nights do I
  // already have", and unscoped it will read another athlete's rows as proof
  // that this athlete's nights are collected, so the backfill silently never
  // pulls them. No error and no empty screen: just a readiness baseline stuck
  // in its 21 night warm-up with no visible cause.
  const existing = await db
    .select({ date: wellnessMetrics.date })
    .from(wellnessMetrics)
    .where(
      and(
        eq(wellnessMetrics.source, "garmin"),
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
        })
        .onConflictDoUpdate({
          target: [wellnessMetrics.source, wellnessMetrics.date],
          set: {
            sleepSeconds: w.sleepSeconds,
            restingHr: w.restingHr,
            hrvLastNightAvg: w.hrvLastNightAvg,
            hrvWeeklyAvg: w.hrvWeeklyAvg,
            hrvStatus: w.hrvStatus,
            source: "garmin",
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

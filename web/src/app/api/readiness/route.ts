import { NextRequest } from "next/server";
import { and, desc, eq, gte, isNotNull, isNull } from "drizzle-orm";
import {
  db,
  activities,
  painLogs,
  strengthSessions,
  strengthSets,
  wellnessLogs,
  wellnessMetrics,
  workouts,
} from "@/db";
import { getActiveProfileId } from "@/lib/profiles";
import { getSessionUserId } from "@/lib/session";
import { expectsPhysiology, isManualOnly, UNANSWERED_DEVICE_SETUP } from "@/lib/device-setup";
import { loadDeviceSetup } from "@/lib/user-device-setup";
import { computeReadiness } from "@/lib/readiness";
import { computePhysiologyReadinessAcrossSources, type WellnessNight } from "@/lib/physiology";
import type { SourceNights } from "@/lib/wellness-source";
import { toGarminDate } from "@/lib/sync/garmin-client";

// ── GET /api/readiness ────────────────────────────────────────────────────────
// Readiness score for the Today view: latest wellness check-in (≤48 h), recent
// pain flags, recent strength RPE, and the run-load trend. Profile-scoped for
// wellness/strength; run load is the owner's (guests have no runs).

export async function GET(request: NextRequest) {
  const profileId = getActiveProfileId(request);
  const now = Date.now();

  try {
    // What the athlete said they wanted connected. Drives two things below:
    // whether the card may claim a recovery baseline is still building, and
    // whether it should say out loud that the score comes from the check-in
    // alone. Falls back to the unanswered state, which behaves exactly as the
    // endpoint did before this existed.
    const userId = await getSessionUserId(request.headers.get("cookie"));
    const deviceSetup = userId
      ? await loadDeviceSetup(userId)
      : UNANSWERED_DEVICE_SETUP;

    const profCond = (col: typeof wellnessLogs.profileId | typeof strengthSessions.profileId) =>
      profileId ? eq(col, profileId) : isNull(col);

    // Latest check-in within 48 h
    const since48h = new Date(now - 48 * 3600_000);
    const [w] = await db
      .select()
      .from(wellnessLogs)
      .where(and(gte(wellnessLogs.date, since48h), profCond(wellnessLogs.profileId)))
      .orderBy(desc(wellnessLogs.date))
      .limit(1);

    // Highest pain score in the last 3 days (owner sessions only carry pain)
    const since3d = new Date(now - 3 * 24 * 3600_000);
    const pains = await db
      .select({ score: painLogs.score })
      .from(painLogs)
      .innerJoin(strengthSessions, eq(painLogs.sessionId, strengthSessions.id))
      .where(
        and(gte(painLogs.createdAt, since3d), profCond(strengthSessions.profileId))
      );
    const maxRecentPain = pains.length
      ? Math.max(...pains.map((p) => p.score))
      : null;

    // Average strength RPE in the last 36 h
    const since36h = new Date(now - 36 * 3600_000);
    const rpes = await db
      .select({ rpe: strengthSets.rpe })
      .from(strengthSets)
      .innerJoin(strengthSessions, eq(strengthSets.sessionId, strengthSessions.id))
      .where(
        and(gte(strengthSets.createdAt, since36h), profCond(strengthSessions.profileId))
      );
    const rpeVals = rpes.map((r) => r.rpe).filter((v): v is number => v != null);
    const recentStrengthRpe = rpeVals.length
      ? rpeVals.reduce((s, v) => s + v, 0) / rpeVals.length
      : null;

    // Highest run RPE in the last 36 h (owner's runs; guests have none)
    let recentRunRpe: number | null = null;
    if (!profileId) {
      const runRpes = await db
        .select({ rpe: workouts.rpe })
        .from(workouts)
        .where(and(gte(workouts.updatedAt, since36h), isNotNull(workouts.rpe)));
      const vals = runRpes.map((r) => r.rpe).filter((v): v is number => v != null);
      recentRunRpe = vals.length ? Math.max(...vals) : null;
    }

    // Run load: last 7 days vs the 3 weeks before (owner's Strava data)
    let last7DaysKm = 0;
    let priorWeeklyAvgKm = 0;
    if (!profileId) {
      const since28d = new Date(now - 28 * 24 * 3600_000);
      const runs = await db
        .select({ distanceKm: activities.distanceKm, startDate: activities.startDate })
        .from(activities)
        .where(gte(activities.startDate, since28d));
      const weekAgo = now - 7 * 24 * 3600_000;
      let priorKm = 0;
      for (const r of runs) {
        if (!r.startDate || !r.distanceKm) continue;
        if (r.startDate.getTime() >= weekAgo) last7DaysKm += r.distanceKm;
        else priorKm += r.distanceKm;
      }
      priorWeeklyAvgKm = priorKm / 3;
    }

    // Overnight physiology (owner only — a household guest has no watch
    // feeding this, same gate as run load above).
    let physiology = null;
    if (!profileId) {
      const since60d = new Date(now - 60 * 24 * 3600_000);
      const rows = await db
        .select({
          date: wellnessMetrics.date,
          sleepSeconds: wellnessMetrics.sleepSeconds,
          restingHr: wellnessMetrics.restingHr,
          hrvLastNightAvg: wellnessMetrics.hrvLastNightAvg,
          source: wellnessMetrics.source,
        })
        .from(wellnessMetrics)
        .where(gte(wellnessMetrics.date, since60d));

      // Group by source before handing off — the baseline math must only
      // ever see one source's nights at a time (see lib/wellness-source.ts).
      const bySourceMap = new Map<string, WellnessNight[]>();
      for (const r of rows) {
        const night: WellnessNight = {
          date: toGarminDate(r.date),
          sleepSeconds: r.sleepSeconds,
          restingHr: r.restingHr,
          hrvLastNightAvg: r.hrvLastNightAvg,
        };
        const list = bySourceMap.get(r.source);
        if (list) list.push(night);
        else bySourceMap.set(r.source, [night]);
      }
      const bySource: SourceNights[] = Array.from(bySourceMap, ([source, nights]) => ({
        source,
        nights,
      }));

      if (rows.length > 0) {
        physiology = computePhysiologyReadinessAcrossSources(bySource, new Date(now));
      }
    }

    const result = computeReadiness({
      wellness: w
        ? {
            ageHours: (now - new Date(w.date).getTime()) / 3600_000,
            energy: w.energy,
            sleepQuality: w.sleepQuality,
            soreness: w.soreness,
            illness: w.illness,
            injury: w.injury,
          }
        : null,
      maxRecentPain,
      recentStrengthRpe,
      recentRunRpe,
      last7DaysKm,
      priorWeeklyAvgKm,
      physiology,
      expectsPhysiology: expectsPhysiology(deviceSetup),
    });

    // manualOnly is the card's cue to name its own inputs. An athlete who
    // chose to record by hand should be told the score is their check-in,
    // rather than left to wonder which sensor it came from.
    return Response.json({ ...result, manualOnly: isManualOnly(deviceSetup) });
  } catch (err) {
    console.error("DB error computing readiness:", err);
    return Response.json({ error: "Failed to compute readiness" }, { status: 500 });
  }
}

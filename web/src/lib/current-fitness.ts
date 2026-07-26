import { and, desc, eq, isNotNull, gte } from "drizzle-orm";
import { db, activities, workouts } from "@/db";
import {
  estimateCurrentFitness,
  FITNESS_WINDOW_DAYS,
  type CurrentFitnessEstimate,
  type RunSample,
} from "@/lib/plan-engine/fitness-estimate";

function isRun(a: { distanceKm: number | null; strengthSessionId: string | null }) {
  return a.strengthSessionId == null && (a.distanceKm ?? 0) > 0.3;
}

/**
 * Reads the athlete's runs from the estimator's recency window and derives a
 * current-fitness VDOT. Single DB-touching entry point so plan creation, the
 * fitness-estimate API, and plan recalibration all read the same data the
 * same way.
 *
 * Also reads the most recent logged race result (if any) within the same
 * window and hands it to the estimator, which gives it precedence over every
 * training run — see estimateCurrentFitness for why.
 */
export async function getCurrentFitnessEstimate(
  now: Date = new Date()
): Promise<CurrentFitnessEstimate | null> {
  const cutoff = new Date(now.getTime() - FITNESS_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [raceRow] = await db
    .select({
      distanceKm: workouts.targetKm,
      durationSeconds: workouts.raceFinishSeconds,
      date: workouts.date,
    })
    .from(workouts)
    .where(
      and(
        eq(workouts.type, "race"),
        isNotNull(workouts.raceFinishSeconds),
        gte(workouts.date, cutoff)
      )
    )
    .orderBy(desc(workouts.date))
    .limit(1);

  const raceResult: RunSample | null =
    raceRow && raceRow.distanceKm != null && raceRow.durationSeconds != null
      ? { distanceKm: raceRow.distanceKm, durationSeconds: raceRow.durationSeconds, date: raceRow.date }
      : null;

  const rows = await db
    .select({
      distanceKm: activities.distanceKm,
      durationSeconds: activities.durationSeconds,
      startDate: activities.startDate,
      strengthSessionId: activities.strengthSessionId,
    })
    .from(activities)
    .where(and(isNotNull(activities.startDate), gte(activities.startDate, cutoff)));

  const runs: RunSample[] = rows
    .filter(isRun)
    .filter((r) => r.distanceKm != null && r.durationSeconds != null && r.startDate != null)
    .map((r) => ({
      distanceKm: r.distanceKm!,
      durationSeconds: r.durationSeconds!,
      date: r.startDate!,
    }));

  return estimateCurrentFitness(runs, now, FITNESS_WINDOW_DAYS, raceResult);
}

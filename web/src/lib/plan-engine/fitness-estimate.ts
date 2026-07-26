/**
 * Estimating an athlete's CURRENT fitness (as opposed to their goal fitness)
 * from logged runs, and reconciling that estimate with a stated goal time.
 *
 * Why this exists: training paces derived purely from a race goal time assume
 * fitness the athlete does not have yet, which is exactly what makes those
 * paces too aggressive to hold. This module estimates VDOT from what the
 * athlete has actually run recently, so paces are grounded in demonstrated
 * ability first and biased toward the goal second (see blendGoalWithCurrentFitness).
 */

import { calculateVdot, RACE_DISTANCES_M } from "./vdot";

/** Standard distances used as fitness-estimate buckets — the same ones Daniels'
 *  tables are built around, and the only ones common enough in logged runs to
 *  give a reliable read. Marathon-length training runs are rare and usually
 *  slow relative to race effort, but the recency window + fastest-of-window
 *  selection below keeps a stray slow long run from winning a bucket over a
 *  genuinely hard one. */
const FITNESS_DISTANCES = {
  "5k": RACE_DISTANCES_M["5k"],
  "10k": RACE_DISTANCES_M["10k"],
  half: RACE_DISTANCES_M.half,
  marathon: RACE_DISTANCES_M.marathon,
} as const;

export type FitnessDistanceKey = keyof typeof FITNESS_DISTANCES;

/** A single logged run — distance/duration/date only. The estimator doesn't
 *  care where it came from (Strava, Garmin, manual entry). */
export interface RunSample {
  distanceKm: number;
  durationSeconds: number;
  date: Date;
}

/** The run that produced the estimate, so the UI can show its reasoning. */
export interface FitnessEstimateSource {
  distanceKey: FitnessDistanceKey;
  distanceKm: number;
  durationSeconds: number;
  date: Date;
}

export interface CurrentFitnessEstimate {
  vdot: number;
  source: FitnessEstimateSource;
}

/** Fitness is "current" only if it was demonstrated recently — a 10k PR from
 *  eight months ago says nothing about today's ability. 90 days covers a
 *  normal training block without dragging in a stale peak. */
export const FITNESS_WINDOW_DAYS = 90;

/** A run only counts toward a distance bucket if it's close enough to be a
 *  real effort at that distance: at least 95% of it (matches the tolerance
 *  the app already uses for personal-record detection), and no more than 15%
 *  over it, so it doesn't bleed into the next bucket up. */
const MIN_DISTANCE_FRACTION = 0.95;
const MAX_DISTANCE_FRACTION = 1.15;

/**
 * Estimate current VDOT from a set of logged runs.
 *
 * For each standard distance, finds the fastest qualifying run within the
 * recency window, converts it to a VDOT via the actual effort (real distance
 * and duration run, not a clipped-to-standard extrapolation). The highest
 * VDOT across buckets is used as the athlete's current fitness — matching how
 * VDOT tables are meant to be read: from the athlete's best recent effort at
 * any distance, since a single race is rarely run at exactly one's peak
 * relative effort for every distance simultaneously.
 *
 * Returns null when there isn't a single qualifying run — the caller falls
 * back to a cold-start value (self-reported level, or the goal itself).
 */
export function estimateCurrentFitness(
  runs: RunSample[],
  now: Date = new Date(),
  windowDays: number = FITNESS_WINDOW_DAYS
): CurrentFitnessEstimate | null {
  const cutoff = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  let best: CurrentFitnessEstimate | null = null;

  for (const key of Object.keys(FITNESS_DISTANCES) as FitnessDistanceKey[]) {
    const standardKm = FITNESS_DISTANCES[key] / 1000;

    let bucketBest: RunSample | null = null;
    let bucketBestPaceSecKm = Infinity;
    for (const run of runs) {
      if (run.date < cutoff) continue;
      if (run.durationSeconds <= 0 || run.distanceKm <= 0) continue;
      if (run.distanceKm < standardKm * MIN_DISTANCE_FRACTION) continue;
      if (run.distanceKm > standardKm * MAX_DISTANCE_FRACTION) continue;

      const paceSecKm = run.durationSeconds / run.distanceKm;
      if (paceSecKm < bucketBestPaceSecKm) {
        bucketBestPaceSecKm = paceSecKm;
        bucketBest = run;
      }
    }

    if (!bucketBest) continue;

    const { vdot } = calculateVdot(bucketBest.distanceKm * 1000, bucketBest.durationSeconds);
    if (!best || vdot > best.vdot) {
      best = {
        vdot,
        source: {
          distanceKey: key,
          distanceKm: bucketBest.distanceKm,
          durationSeconds: bucketBest.durationSeconds,
          date: bucketBest.date,
        },
      };
    }
  }

  return best;
}

/**
 * How far above demonstrated current fitness a goal is allowed to push
 * training paces. A realistic VDOT gain over one training block is roughly
 * 5-10%; capping the uplift at 8% means an ambitious goal still nudges paces
 * faster than today's fitness (rewarding the athlete for reaching), but never
 * prescribes paces that only the FINISHED training block, not the one about
 * to start, could sustain. Below current fitness the goal is trusted as-is —
 * a conservative goal (run/walk, "just finish") is a deliberate choice, not
 * an error to correct.
 */
export const CURRENT_FITNESS_UPLIFT_CAP = 0.08;

/**
 * Blend a goal-derived VDOT with a current-fitness VDOT for pace-setting.
 *
 * Race plans keep the goal time for everything schedule-related (plan length,
 * taper timing, race-day pace target) — only the VDOT that DRIVES DAILY
 * TRAINING PACES is capped here. When there's no current-fitness estimate
 * (cold start, e.g. a brand-new athlete with no synced history), the goal
 * VDOT is used unchanged, same as before this module existed.
 */
export function blendGoalWithCurrentFitness(
  goalVdot: number,
  currentVdot: number | null | undefined
): number {
  if (currentVdot == null || currentVdot <= 0) return goalVdot;
  const cap = currentVdot * (1 + CURRENT_FITNESS_UPLIFT_CAP);
  return Math.min(goalVdot, cap);
}

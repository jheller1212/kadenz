/**
 * VDOT calculator using Jack Daniels' Running Formula.
 *
 * The two core equations from Daniels (2005):
 *
 * (1) %VO2max as a function of race duration t (minutes):
 *     pct(t) = 0.8 + 0.1894393·exp(-0.012778·t)
 *                  + 0.2989558·exp(-0.1932605·t)
 *
 * (2) VO2 cost of running at speed v (metres per minute):
 *     VO2(v) = -4.60 + 0.182258·v + 0.000104·v²
 *
 * VDOT = VO2(v_race) / pct(t_race)
 *
 * where v_race = distanceMeters / durationMinutes
 *
 * All internal times in minutes; paces in sec/km.
 */

import type { VdotResult } from "./types";

/**
 * Fraction of VO2max utilized at a given race duration (minutes).
 */
export function pctVO2maxAtDuration(durationMinutes: number): number {
  const t = durationMinutes;
  return (
    0.8 +
    0.1894393 * Math.exp(-0.012778 * t) +
    0.2989558 * Math.exp(-0.1932605 * t)
  );
}

/**
 * Oxygen cost (ml/kg/min) of running at speed v (metres per minute).
 */
export function vo2AtSpeed(speedMperMin: number): number {
  const v = speedMperMin;
  return -4.6 + 0.182258 * v + 0.000104 * v * v;
}

/**
 * Calculate VDOT from a race performance.
 *
 * @param distanceMeters - Race distance in metres
 * @param timeSeconds    - Finish time in seconds
 */
export function calculateVdot(
  distanceMeters: number,
  timeSeconds: number
): VdotResult {
  if (distanceMeters <= 0) throw new Error("distanceMeters must be positive");
  if (timeSeconds <= 0) throw new Error("timeSeconds must be positive");

  const durationMinutes = timeSeconds / 60;
  const speedMperMin = distanceMeters / durationMinutes;

  const pct = pctVO2maxAtDuration(durationMinutes);
  const vo2 = vo2AtSpeed(speedMperMin);
  const vdot = vo2 / pct;

  return { vdot, pctVO2max: pct };
}

/**
 * Running speed (metres per minute) at which VO2 equals the given value.
 * Inverse of: VO2 = -4.60 + 0.182258·v + 0.000104·v²
 */
export function speedAtVO2(vo2: number): number {
  const a = 0.000104;
  const b = 0.182258;
  const c = -4.6 - vo2;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) throw new Error(`No real solution for VO2=${vo2}`);
  return (-b + Math.sqrt(discriminant)) / (2 * a);
}

/**
 * Predict finish time for a race distance given VDOT.
 * Uses bisection to invert the VDOT equation (which requires solving for duration
 * in both the %VO2max term and the speed-from-duration term simultaneously).
 *
 * At any candidate duration t_min, the speed = distanceMeters / t_min,
 * so VDOT_candidate = VO2(v) / pct(t). Bisect until it matches target VDOT.
 *
 * @param vdot            - Athlete's VDOT (ml/kg/min)
 * @param distanceMeters  - Target race distance in metres
 * @returns Predicted finish time in seconds
 */
export function predictRaceTime(vdot: number, distanceMeters: number): number {
  if (vdot <= 0) throw new Error("vdot must be positive");
  if (distanceMeters <= 0) throw new Error("distanceMeters must be positive");

  function vdotAtDuration(t: number): number {
    const v = distanceMeters / t; // m/min
    const pct = pctVO2maxAtDuration(t);
    return vo2AtSpeed(v) / pct;
  }

  // Bisect over a reasonable range: 1 minute to 10 hours
  let lo = 1; // minutes
  let hi = 600; // minutes

  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (vdotAtDuration(mid) > vdot) {
      // VDOT too high → need slower (longer) time
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return ((lo + hi) / 2) * 60; // convert to seconds
}

/** Race distance in metres for standard distances */
export const RACE_DISTANCES_M = {
  "5k": 5000,
  "10k": 10000,
  half: 21097.5,
  marathon: 42195,
  mile: 1609.344,
} as const;

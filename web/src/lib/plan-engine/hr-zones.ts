/**
 * Heart-rate zones using the Karvonen (heart-rate reserve) method.
 *
 * HRR = HRmax - HRrest
 * Zone target = HRrest + fraction * HRR
 *
 * Zone boundaries (% HRR):
 *   Z1 (Recovery)    50–60%
 *   Z2 (Aerobic)     60–70%
 *   Z3 (Tempo)       70–80%
 *   Z4 (Threshold)   80–90%
 *   Z5 (VO2max)      90–100%
 *
 * When maxHr is not provided it is estimated as 208 - 0.7 * age (Tanaka formula).
 */

import type { HrZone, HrZones } from "./types";

/** Estimate maximum heart rate from age using Tanaka formula */
export function estimateMaxHr(age: number): number {
  if (age <= 0) throw new Error("age must be positive");
  return Math.round(208 - 0.7 * age);
}

/**
 * Calculate five Karvonen heart-rate zones.
 *
 * @param restingHr - Resting heart rate (bpm)
 * @param age       - Athlete's age in years (used to estimate HRmax if maxHr omitted)
 * @param maxHr     - Measured max HR (bpm); estimated from age if not provided
 */
export function getHrZones(
  restingHr: number,
  age: number,
  maxHr?: number
): HrZones {
  if (restingHr <= 0) throw new Error("restingHr must be positive");

  const hrMax = maxHr ?? estimateMaxHr(age);
  if (hrMax <= restingHr)
    throw new Error("maxHr must be greater than restingHr");

  const hrr = hrMax - restingHr;

  function karvonen(loPct: number, hiPct: number): HrZone {
    return {
      min: Math.round(restingHr + loPct * hrr),
      max: Math.round(restingHr + hiPct * hrr),
    };
  }

  return {
    z1: karvonen(0.5, 0.6),
    z2: karvonen(0.6, 0.7),
    z3: karvonen(0.7, 0.8),
    z4: karvonen(0.8, 0.9),
    z5: karvonen(0.9, 1.0),
  };
}

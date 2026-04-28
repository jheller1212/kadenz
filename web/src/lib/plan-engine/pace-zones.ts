/**
 * Pace zones derived from VDOT using Daniels' %VO2max intensity ranges.
 *
 * Zone    %VO2max range    Purpose
 * ─────────────────────────────────
 * E       59–74%           Easy / long run
 * M       75–84%           Marathon race pace
 * T       86–88%           Tempo / threshold
 * I       95–100%          Interval (VO2max)
 * R       >100% (supra)    Repetition / speed
 *
 * All paces returned in seconds per km.
 *
 * Derivation:
 *   VO2 at fraction f  = f * VDOT
 *   Speed (m/min) from inverse Daniels oxygen-cost equation:
 *     VO2 = -4.60 + 0.182258·v + 0.000104·v²
 *   Solve for v using quadratic formula.
 *   Pace (sec/km) = 1000 / (v / 60)
 */

import type { PaceZone, PaceZones } from "./types";
import { speedAtVO2 } from "./vdot";

/** Convert speed (m/min) to pace (sec/km) */
function speedToPace(speedMperMin: number): number {
  return (1000 / speedMperMin) * 60;
}

/** Build a PaceZone from a %VO2max range [lo, hi] and VDOT */
function zone(vdot: number, loFraction: number, hiFraction: number): PaceZone {
  const targetFraction = (loFraction + hiFraction) / 2;

  // Higher fraction = faster = lower pace value
  const fastSpeed = speedAtVO2(hiFraction * vdot); // fastest (hi %)
  const slowSpeed = speedAtVO2(loFraction * vdot); // slowest (lo %)
  const targetSpeed = speedAtVO2(targetFraction * vdot);

  return {
    minPaceSecKm: Math.round(speedToPace(fastSpeed)), // fastest = min pace number
    targetPaceSecKm: Math.round(speedToPace(targetSpeed)),
    maxPaceSecKm: Math.round(speedToPace(slowSpeed)), // slowest = max pace number
  };
}

/**
 * Derive all five training pace zones from VDOT.
 *
 * @param vdot - Athlete's VDOT (ml/kg/min)
 */
export function getPaceZones(vdot: number): PaceZones {
  if (vdot <= 0) throw new Error("vdot must be positive");

  return {
    E: zone(vdot, 0.59, 0.74),
    M: zone(vdot, 0.75, 0.84),
    T: zone(vdot, 0.86, 0.88),
    I: zone(vdot, 0.95, 1.0),
    // R zone: 105-120% VO2max (supra-maximal)
    R: zone(vdot, 1.05, 1.2),
  };
}

/** Format pace (sec/km) as "mm:ss" string */
export function formatPace(secPerKm: number): string {
  const mins = Math.floor(secPerKm / 60);
  const secs = Math.round(secPerKm % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

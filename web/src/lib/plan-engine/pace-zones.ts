/**
 * Pace zones derived from VDOT using Daniels' %VO2max intensity ranges.
 *
 * Zone    %VO2max range    Purpose
 * ─────────────────────────────────
 * E       59–75%           Easy / long run
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

// Absolute fastest realistic paces (sec/km) — nobody runs faster than these
const MIN_PACE: Record<string, number> = {
  E: 240, // 4:00/km easy (elite easy pace)
  M: 175, // 2:55/km marathon WR pace
  T: 165, // 2:45/km threshold
  I: 145, // 2:25/km interval
  R: 130, // 2:10/km reps
};

/** Build a PaceZone from a %VO2max range [lo, hi] and VDOT */
function zone(vdot: number, loFraction: number, hiFraction: number, zoneKey?: string): PaceZone {
  const targetFraction = (loFraction + hiFraction) / 2;

  // Higher fraction = faster = lower pace value
  const fastSpeed = speedAtVO2(hiFraction * vdot); // fastest (hi %)
  const slowSpeed = speedAtVO2(loFraction * vdot); // slowest (lo %)
  const targetSpeed = speedAtVO2(targetFraction * vdot);

  const floor = zoneKey ? (MIN_PACE[zoneKey] ?? 120) : 120;

  return {
    minPaceSecKm: Math.max(floor, Math.round(speedToPace(fastSpeed))),
    targetPaceSecKm: Math.max(floor, Math.round(speedToPace(targetSpeed))),
    maxPaceSecKm: Math.max(floor, Math.round(speedToPace(slowSpeed))),
  };
}

// Lowest VDOT the Daniels equations stay well-behaved for. Below this, an
// extreme goal time (see StepGoal's GOAL_TIME_RANGES.slow ceiling, which is
// meant to stop this in the wizard) can drive vo2AtSpeed negative. The wizard
// is the real fix; this floor exists so a config that reaches generation some
// other way still produces a (very conservative) plan instead of throwing.
const MIN_VDOT = 20;

/**
 * Derive all five training pace zones from VDOT.
 *
 * @param vdot - Athlete's VDOT (ml/kg/min)
 */
export function getPaceZones(vdot: number): PaceZones {
  const safeVdot = vdot > 0 ? Math.max(vdot, MIN_VDOT) : MIN_VDOT;

  return {
    E: zone(safeVdot, 0.59, 0.75, "E"),
    M: zone(safeVdot, 0.75, 0.84, "M"),
    T: zone(safeVdot, 0.86, 0.88, "T"),
    I: zone(safeVdot, 0.95, 1.0, "I"),
    // R zone: 105-120% VO2max (supra-maximal)
    R: zone(safeVdot, 1.05, 1.2, "R"),
  };
}

/** Format pace (sec/km) as "mm:ss" string. If miles=true, converts to sec/mile. */
export function formatPace(secPerKm: number, miles?: boolean): string {
  const pace = miles ? secPerKm * 1.60934 : secPerKm;
  const mins = Math.floor(pace / 60);
  const secs = Math.round(pace % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/** Format distance — km or miles */
export function formatDistance(km: number, miles?: boolean): string {
  if (miles) return `${(km * 0.621371).toFixed(1)} mi`;
  return `${km.toFixed(1)} km`;
}

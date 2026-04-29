/**
 * Plan generator — produces a full training plan structure ready for DB insertion.
 *
 * Phase breakdown (approximate):
 *   Base   ~30% — aerobic base, easy/long runs only
 *   Build  ~40% — quality sessions introduced (tempo, intervals)
 *   Peak   ~20% — highest volume / intensity
 *   Taper  ~10% — reduce volume 40–50%, maintain some quality
 *
 * Deload weeks occur every 3rd or 4th week within base/build/peak phases.
 * Deload volume is 70% of the preceding week.
 */

import { calculateVdot, RACE_DISTANCES_M } from "./vdot";
import { getPaceZones } from "./pace-zones";
import type {
  PlanConfig,
  GeneratedPlan,
  GeneratedWeek,
  GeneratedWorkout,
  GeneratedBlock,
  WeekPhase,
  WeekType,
  WorkoutType,
  PaceZones,
} from "./types";

// ── Constants ────────────────────────────────────────────────────────────────

/** Base weekly km targets per volume tier (starting point for first full week) */
const BASE_KM: Record<string, number> = {
  beginner: 10,
  low: 20,
  medium: 35,
  high: 50,
  elite: 70,
};

/** Peak weekly km caps per volume tier */
const PEAK_KM: Record<string, number> = {
  beginner: 30,
  low: 45,
  medium: 70,
  high: 100,
  elite: 140,
};

/** Max weekly km increase rate (fraction, e.g. 0.10 = 10%) */
const MAX_WEEKLY_INCREASE = 0.10;

/** Pace adjustment factor per race elevation category */
const ELEVATION_PACE_FACTOR: Record<string, number> = {
  flat: 1.0,
  rolling: 1.04,
  hilly: 1.08,
  mountainous: 1.14,
};

/** Quality-session frequency adjustments per difficulty */
const QUALITY_DAYS: Record<string, number> = {
  easy: 1,
  moderate: 1,
  hard: 2,
};

/** Hilly area pace adjustment factor (slower on uphills, treat as +8% effort) */
const HILLY_PACE_FACTOR = 1.08; // legacy, used as fallback

// ── Helpers ──────────────────────────────────────────────────────────────────

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Format seconds as "H:MM:SS" or "MM:SS" */
function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.round(totalSeconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Race distance in metres */
function raceDistanceMeters(d: string): number {
  return RACE_DISTANCES_M[d as keyof typeof RACE_DISTANCES_M] ?? 0;
}

/** Race distance in km */
function raceDistanceKm(d: string): number {
  return raceDistanceMeters(d) / 1000;
}

/** Label for race distance */
function raceLabel(d: string): string {
  const labels: Record<string, string> = {
    "5k": "5K",
    "10k": "10K",
    half: "Half Marathon",
    marathon: "Marathon",
  };
  return labels[d] ?? d;
}

/**
 * Distribute plan weeks into phases.
 * Returns array of WeekPhase, one per week (1-indexed access via [i-1]).
 */
function buildPhaseMap(totalWeeks: number): WeekPhase[] {
  const taperWeeks = Math.max(1, Math.round(totalWeeks * 0.1));

  if (totalWeeks <= 9) {
    // Short plans: minimal base (1 week), jump to build quickly
    const baseWeeks = 1;
    const peakWeeks = Math.max(1, Math.round(totalWeeks * 0.15));
    const buildWeeks = totalWeeks - baseWeeks - peakWeeks - taperWeeks;
    const phases: WeekPhase[] = [];
    for (let i = 0; i < baseWeeks; i++) phases.push("base");
    for (let i = 0; i < buildWeeks; i++) phases.push("build");
    for (let i = 0; i < peakWeeks; i++) phases.push("peak");
    for (let i = 0; i < taperWeeks; i++) phases.push("taper");
    while (phases.length < totalWeeks) phases.splice(phases.length - taperWeeks, 0, "build");
    return phases.slice(0, totalWeeks);
  }

  // Standard plans (10+ weeks)
  const peakWeeks = Math.max(1, Math.round(totalWeeks * 0.2));
  const buildWeeks = Math.max(1, Math.round(totalWeeks * 0.4));
  const baseWeeks = totalWeeks - buildWeeks - peakWeeks - taperWeeks;

  const phases: WeekPhase[] = [];
  for (let i = 0; i < baseWeeks; i++) phases.push("base");
  for (let i = 0; i < buildWeeks; i++) phases.push("build");
  for (let i = 0; i < peakWeeks; i++) phases.push("peak");
  for (let i = 0; i < taperWeeks; i++) phases.push("taper");

  // Pad or trim to exactly totalWeeks (rounding can drift by 1)
  while (phases.length < totalWeeks) phases.splice(phases.length - taperWeeks, 0, "peak");
  return phases.slice(0, totalWeeks);
}

/**
 * Determine week type (normal / deload / race).
 * Deload every 3rd or 4th week within base/build/peak; taper weeks are always normal.
 * The last week is always "race".
 */
function weekType(
  weekIndex: number, // 0-based
  totalWeeks: number,
  phase: WeekPhase
): WeekType {
  if (weekIndex === totalWeeks - 1) return "race";
  if (phase === "taper") return "normal";
  // Deload every 4th week (weeks 4, 8, 12, …)
  if ((weekIndex + 1) % 4 === 0) return "deload";
  return "normal";
}

/**
 * Compute target weekly km for each week.
 * Starts at max(currentWeeklyKm, baseKm) and ramps linearly to peakKm,
 * with deload weeks at 70%, taper weeks stepping down 40–50%.
 */
function buildVolumeProgression(
  config: PlanConfig,
  phases: WeekPhase[],
  totalWeeks: number
): number[] {
  const volKey = config.trainingVolume;
  const startKm = Math.max(config.currentWeeklyKm, BASE_KM[volKey]);
  const peakKm = PEAK_KM[volKey];

  // Count non-taper, non-race weeks to spread the ramp over
  const taperStart = phases.indexOf("taper");
  const rampWeeks = taperStart >= 0 ? taperStart : totalWeeks - 1;

  const volumes: number[] = [];
  let lastNormalKm = startKm;

  for (let i = 0; i < totalWeeks; i++) {
    const phase = phases[i];
    const type = weekType(i, totalWeeks, phase);

    if (type === "race") {
      // Race week: minimal volume (~30% of last normal)
      volumes.push(Math.round(lastNormalKm * 0.3));
      continue;
    }

    if (phase === "taper") {
      const taperIndex = i - (taperStart >= 0 ? taperStart : i);
      const taperFactor = 0.6 - taperIndex * 0.1; // 60%, 50%, …
      volumes.push(Math.round(lastNormalKm * Math.max(taperFactor, 0.3)));
      continue;
    }

    // Ramp within base/build/peak, capped at MAX_WEEKLY_INCREASE per week
    const progress = rampWeeks > 1 ? i / (rampWeeks - 1) : 1;
    const uncappedKm = startKm + (peakKm - startKm) * progress;
    // Cap: don't increase more than MAX_WEEKLY_INCREASE over last normal week
    const maxAllowed = lastNormalKm * (1 + MAX_WEEKLY_INCREASE);
    const targetKm = Math.min(uncappedKm, maxAllowed, peakKm);

    if (type === "deload") {
      volumes.push(Math.round(targetKm * 0.7));
    } else {
      lastNormalKm = Math.round(targetKm);
      volumes.push(lastNormalKm);
    }
  }

  return volumes;
}

// ── Block builders ───────────────────────────────────────────────────────────

function applyHilly(pace: number, hillyArea: boolean, raceElevation?: string): number {
  if (raceElevation && raceElevation !== "flat") {
    return Math.round(pace * (ELEVATION_PACE_FACTOR[raceElevation] ?? 1));
  }
  return hillyArea ? Math.round(pace * HILLY_PACE_FACTOR) : pace;
}

function warmupBlock(
  paces: PaceZones,
  hillyArea: boolean,
  distanceKm = 1.5
): GeneratedBlock {
  return {
    sortOrder: 0,
    type: "warmup",
    distanceKm,
    targetPaceSecKm: applyHilly(paces.E.targetPaceSecKm, hillyArea),
    minPaceSecKm: applyHilly(paces.E.minPaceSecKm, hillyArea),
    maxPaceSecKm: applyHilly(paces.E.maxPaceSecKm, hillyArea),
  };
}

function cooldownBlock(
  paces: PaceZones,
  hillyArea: boolean,
  distanceKm = 1.0
): GeneratedBlock {
  return {
    sortOrder: 99,
    type: "cooldown",
    distanceKm,
    targetPaceSecKm: applyHilly(paces.E.targetPaceSecKm, hillyArea),
    minPaceSecKm: applyHilly(paces.E.minPaceSecKm, hillyArea),
    maxPaceSecKm: applyHilly(paces.E.maxPaceSecKm, hillyArea),
  };
}

function easyBlocks(
  paces: PaceZones,
  hillyArea: boolean,
  distanceKm: number
): GeneratedBlock[] {
  return [
    {
      sortOrder: 0,
      type: "work",
      distanceKm,
      targetPaceSecKm: applyHilly(paces.E.targetPaceSecKm, hillyArea),
      minPaceSecKm: applyHilly(paces.E.minPaceSecKm, hillyArea),
      maxPaceSecKm: applyHilly(paces.E.maxPaceSecKm, hillyArea),
    },
  ];
}

function tempoBlocks(
  paces: PaceZones,
  hillyArea: boolean,
  workKm: number
): GeneratedBlock[] {
  // Benchmark-style: alternating tempo/steady segments instead of one flat block
  // e.g. 2km warm-up, 1km @ tempo, 1km @ steady, 1km @ tempo, 1km @ steady, 1km cool-down
  const tempoPace = applyHilly(paces.T.targetPaceSecKm, hillyArea);
  const steadyPace = applyHilly(paces.M.targetPaceSecKm, hillyArea);

  if (workKm >= 6) {
    // Progressive alternating: tempo/steady segments
    const segmentKm = 1;
    const numSegments = Math.floor(workKm / segmentKm);
    const blocks: GeneratedBlock[] = [warmupBlock(paces, hillyArea)];
    let order = 1;

    for (let i = 0; i < numSegments; i++) {
      const isTempo = i % 2 === 0;
      blocks.push({
        sortOrder: order++,
        type: "work",
        distanceKm: segmentKm,
        targetPaceSecKm: isTempo ? tempoPace : steadyPace,
        minPaceSecKm: isTempo ? applyHilly(paces.T.minPaceSecKm, hillyArea) : applyHilly(paces.M.minPaceSecKm, hillyArea),
        maxPaceSecKm: isTempo ? applyHilly(paces.T.maxPaceSecKm, hillyArea) : applyHilly(paces.M.maxPaceSecKm, hillyArea),
      });
    }

    blocks.push({ ...cooldownBlock(paces, hillyArea), sortOrder: order });
    return blocks;
  }

  // Short tempo: single sustained block
  return [
    warmupBlock(paces, hillyArea),
    {
      sortOrder: 1,
      type: "work",
      distanceKm: workKm,
      targetPaceSecKm: tempoPace,
      minPaceSecKm: applyHilly(paces.T.minPaceSecKm, hillyArea),
      maxPaceSecKm: applyHilly(paces.T.maxPaceSecKm, hillyArea),
    },
    cooldownBlock(paces, hillyArea),
  ];
}

function intervalBlocks(
  paces: PaceZones,
  hillyArea: boolean,
  reps: number,
  repDistanceKm: number
): GeneratedBlock[] {
  // Benchmark-style: varied rep distances (descending ladder or mixed)
  const intervalPace = applyHilly(paces.I.targetPaceSecKm, hillyArea);
  const blocks: GeneratedBlock[] = [warmupBlock(paces, hillyArea)];
  let order = 1;

  if (reps >= 6) {
    // Ladder: e.g. 1000m, 800m, 600m, 600m, 800m, 1000m
    const ladder = buildLadder(reps, repDistanceKm);
    for (const dist of ladder) {
      blocks.push({
        sortOrder: order++,
        type: "work",
        reps: 1,
        repDistanceKm: dist,
        repRestSeconds: Math.round(dist >= 0.8 ? 90 : 60),
        targetPaceSecKm: intervalPace,
        minPaceSecKm: applyHilly(paces.I.minPaceSecKm, hillyArea),
        maxPaceSecKm: applyHilly(paces.I.maxPaceSecKm, hillyArea),
      });
      // Recovery jog between reps
      blocks.push({
        sortOrder: order++,
        type: "recovery",
        durationMinutes: dist >= 0.8 ? 2 : 1,
      });
    }
  } else {
    // Standard reps
    blocks.push({
      sortOrder: order++,
      type: "work",
      reps,
      repDistanceKm,
      repRestSeconds: 90,
      targetPaceSecKm: intervalPace,
      minPaceSecKm: applyHilly(paces.I.minPaceSecKm, hillyArea),
      maxPaceSecKm: applyHilly(paces.I.maxPaceSecKm, hillyArea),
    });
    blocks.push({
      sortOrder: order++,
      type: "recovery",
      durationMinutes: Math.round((reps * 90) / 60),
    });
  }

  blocks.push({ ...cooldownBlock(paces, hillyArea), sortOrder: order });
  return blocks;
}

/** Build a descending/ascending ladder of distances for interval sessions */
function buildLadder(reps: number, baseDistKm: number): number[] {
  // Pyramid: 1000, 800, 600, 600, 800, 1000 (adjusted to rep count)
  const half = Math.ceil(reps / 2);
  const descending: number[] = [];
  for (let i = 0; i < half; i++) {
    const factor = 1 - (i * 0.2); // 1.0, 0.8, 0.6, ...
    descending.push(Math.round(baseDistKm * Math.max(factor, 0.4) * 1000) / 1000);
  }
  const ascending = descending.slice(0, reps - half).reverse();
  return [...descending, ...ascending];
}

function longRunBlocks(
  paces: PaceZones,
  hillyArea: boolean,
  distanceKm: number
): GeneratedBlock[] {
  return [
    {
      sortOrder: 0,
      type: "work",
      distanceKm,
      targetPaceSecKm: applyHilly(paces.E.targetPaceSecKm, hillyArea),
      minPaceSecKm: applyHilly(paces.E.minPaceSecKm, hillyArea),
      maxPaceSecKm: applyHilly(paces.E.maxPaceSecKm, hillyArea),
    },
  ];
}

function raceBlocks(
  config: PlanConfig,
  paces: PaceZones
): GeneratedBlock[] {
  const distKm = raceDistanceKm(config.raceDistance);
  return [
    {
      sortOrder: 0,
      type: "warmup",
      distanceKm: config.raceDistance === "5k" ? 1.0 : 2.0,
      targetPaceSecKm: paces.E.targetPaceSecKm,
    },
    {
      sortOrder: 1,
      type: "work",
      distanceKm: distKm,
      targetPaceSecKm: Math.round(config.goalTimeSeconds / distKm),
    },
  ];
}

// ── Workout builders ─────────────────────────────────────────────────────────

/** Estimate duration (minutes) from distance and target pace */
function estimateDuration(distanceKm: number, targetPaceSecKm: number): number {
  return Math.round((distanceKm * targetPaceSecKm) / 60);
}

function buildEasyWorkout(
  dayOfWeek: number,
  date: Date,
  distanceKm: number,
  paces: PaceZones,
  hillyArea: boolean,
  sortOrder: number
): GeneratedWorkout {
  const blocks = easyBlocks(paces, hillyArea, distanceKm);
  return {
    dayOfWeek,
    date,
    type: "easy",
    title: `Easy Run ${distanceKm}km`,
    description: "Conversational pace. Should feel easy throughout.",
    targetKm: distanceKm,
    targetDurationMinutes: estimateDuration(distanceKm, paces.E.targetPaceSecKm),
    sortOrder,
    blocks,
  };
}

function buildLongRunWorkout(
  dayOfWeek: number,
  date: Date,
  distanceKm: number,
  paces: PaceZones,
  hillyArea: boolean,
  sortOrder: number
): GeneratedWorkout {
  const blocks = longRunBlocks(paces, hillyArea, distanceKm);
  return {
    dayOfWeek,
    date,
    type: "long",
    title: `Long Run ${distanceKm}km`,
    description:
      "Easy effort throughout. Goal is time on feet. Fuel and hydrate if over 75 min.",
    targetKm: distanceKm,
    targetDurationMinutes: estimateDuration(distanceKm, paces.E.targetPaceSecKm),
    sortOrder,
    blocks,
  };
}

function buildTempoWorkout(
  dayOfWeek: number,
  date: Date,
  workKm: number,
  paces: PaceZones,
  hillyArea: boolean,
  sortOrder: number
): GeneratedWorkout {
  const totalKm = 1.5 + workKm + 1.0;
  const blocks = tempoBlocks(paces, hillyArea, workKm);
  return {
    dayOfWeek,
    date,
    type: "tempo",
    title: `Tempo Run ${workKm}km`,
    description: `Warmup 1.5km easy, then ${workKm}km at threshold pace (comfortably hard), cooldown 1km easy.`,
    targetKm: totalKm,
    targetDurationMinutes:
      estimateDuration(1.5, paces.E.targetPaceSecKm) +
      estimateDuration(workKm, paces.T.targetPaceSecKm) +
      estimateDuration(1.0, paces.E.targetPaceSecKm),
    sortOrder,
    blocks,
  };
}

function buildIntervalWorkout(
  dayOfWeek: number,
  date: Date,
  reps: number,
  repKm: number,
  paces: PaceZones,
  hillyArea: boolean,
  sortOrder: number
): GeneratedWorkout {
  const workKm = reps * repKm;
  const totalKm = 1.5 + workKm + 1.0;
  const blocks = intervalBlocks(paces, hillyArea, reps, repKm);
  return {
    dayOfWeek,
    date,
    type: "interval",
    title: `Intervals ${reps}x${repKm * 1000}m`,
    description: `Warmup 1.5km, then ${reps}x${repKm * 1000}m at VO2max pace with 90s rest, cooldown 1km.`,
    targetKm: totalKm,
    targetDurationMinutes:
      estimateDuration(1.5, paces.E.targetPaceSecKm) +
      estimateDuration(workKm, paces.I.targetPaceSecKm) +
      Math.round((reps * 90) / 60) +
      estimateDuration(1.0, paces.E.targetPaceSecKm),
    sortOrder,
    blocks,
  };
}

function buildRestWorkout(
  dayOfWeek: number,
  date: Date,
  sortOrder: number
): GeneratedWorkout {
  return {
    dayOfWeek,
    date,
    type: "rest",
    title: "Rest Day",
    description: "Complete rest or light cross-training.",
    sortOrder,
    blocks: [],
  };
}

function buildRaceWorkout(
  dayOfWeek: number,
  date: Date,
  config: PlanConfig,
  paces: PaceZones,
  sortOrder: number
): GeneratedWorkout {
  const distKm = raceDistanceKm(config.raceDistance);
  return {
    dayOfWeek,
    date,
    type: "race",
    title: `Race Day — ${raceLabel(config.raceDistance)}`,
    description: `Goal time: ${formatTime(config.goalTimeSeconds)}. Trust your training.`,
    targetKm: distKm,
    targetDurationMinutes: Math.round(config.goalTimeSeconds / 60),
    sortOrder,
    blocks: raceBlocks(config, paces),
  };
}

// ── Week workout schedule builder ────────────────────────────────────────────

/**
 * Pick training days given daysPerWeek and the preferred long run day.
 * Returns array of dayOfWeek values (0–6) in ascending order.
 *
 * Strategy:
 * - Always include preferredLongRunDay.
 * - Fill remaining days spread across the week, leaving rest days in between.
 * - Avoid back-to-back quality sessions.
 */
function pickTrainingDays(
  daysPerWeek: number,
  preferredLongRunDay: number
): number[] {
  if (daysPerWeek < 1 || daysPerWeek > 7) {
    throw new Error("daysPerWeek must be between 1 and 7");
  }

  // Default patterns for 3–6 days/week (Mon=1 based, with long on preferred day)
  // We build a generic spread and then ensure the long run day is included.
  const allDays = [0, 1, 2, 3, 4, 5, 6];
  const selected = new Set<number>([preferredLongRunDay]);

  // Candidate days excluding preferred: spread evenly
  const candidates = allDays.filter((d) => d !== preferredLongRunDay);
  // Sort by distance from preferred day in circular fashion to spread them out
  candidates.sort((a, b) => {
    const distA = Math.min(
      Math.abs(a - preferredLongRunDay),
      7 - Math.abs(a - preferredLongRunDay)
    );
    const distB = Math.min(
      Math.abs(b - preferredLongRunDay),
      7 - Math.abs(b - preferredLongRunDay)
    );
    return distB - distA; // furthest first = most spread
  });

  for (const d of candidates) {
    if (selected.size >= daysPerWeek) break;
    selected.add(d);
  }

  // Sort Monday-first: Mon(1), Tue(2), ..., Sat(6), Sun(0)
  return Array.from(selected).sort((a, b) => {
    const ma = a === 0 ? 7 : a;
    const mb = b === 0 ? 7 : b;
    return ma - mb;
  });
}

/**
 * Assign workout types to training days for a given week.
 * Returns a map from dayOfWeek → WorkoutType.
 */
function assignWorkoutTypes(
  trainingDays: number[],
  phase: WeekPhase,
  weekType: WeekType,
  preferredLongRunDay: number,
  qualityDays: number,
  trainingDifficulty: string
): Map<number, WorkoutType> {
  const map = new Map<number, WorkoutType>();

  if (weekType === "race") {
    // Race week: long run day becomes the race, rest are easy/rest
    for (const day of trainingDays) {
      if (day === preferredLongRunDay) {
        map.set(day, "race");
      } else {
        map.set(day, "easy");
      }
    }
    return map;
  }

  // Long run always on preferred day
  map.set(preferredLongRunDay, "long");

  const remainingDays = trainingDays.filter((d) => d !== preferredLongRunDay);

  let qualityRemaining = phase === "base" ? 0 : qualityDays;
  if (weekType === "deload") qualityRemaining = Math.min(1, qualityRemaining);

  // Assign quality sessions first, then easy runs
  // Place quality sessions with at least 1 rest day before long run
  let tempoAssigned = false;
  let intervalAssigned = false;

  for (const day of remainingDays) {
    if (qualityRemaining > 0) {
      if (!tempoAssigned && phase !== "base") {
        map.set(day, "tempo");
        tempoAssigned = true;
        qualityRemaining--;
      } else if (
        !intervalAssigned &&
        qualityRemaining > 0 &&
        (phase === "peak" || trainingDifficulty === "hard")
      ) {
        map.set(day, "interval");
        intervalAssigned = true;
        qualityRemaining--;
      } else {
        map.set(day, "easy");
      }
    } else {
      map.set(day, "easy");
    }
  }

  return map;
}

// ── Volume distribution ──────────────────────────────────────────────────────

/**
 * Distribute weekly km across workouts.
 * Long run gets ~30–35% of weekly volume (capped).
 * Quality sessions get ~15–20%.
 * Easy runs split the rest.
 */
function distributeVolume(
  weeklyKm: number,
  typeMap: Map<number, WorkoutType>,
  longRunCapKm: number,
  raceDistance: string,
  easyRunMinKm: number = 0
): Map<number, number> {
  const distMap = new Map<number, number>();
  const raceLenKm = raceDistanceKm(raceDistance);

  let longRunKm = Math.round(weeklyKm * 0.32);
  if (longRunCapKm > 0) {
    longRunKm = Math.min(longRunKm, longRunCapKm);
  }
  // Long run should not exceed 120% of race distance for shorter races
  if (["5k", "10k"].includes(raceDistance)) {
    longRunKm = Math.min(longRunKm, Math.round(raceLenKm * 2.5));
  }
  longRunKm = Math.max(longRunKm, 6); // minimum 6km long run

  let remainingKm = weeklyKm - longRunKm;

  // Count workout types
  let easyCount = 0;
  let tempoCount = 0;
  let intervalCount = 0;

  for (const [, type] of typeMap) {
    if (type === "easy" || type === "recovery") easyCount++;
    else if (type === "tempo") tempoCount++;
    else if (type === "interval") intervalCount++;
  }

  // Quality session work distances
  const tempoWorkKm = Math.max(3, Math.round(weeklyKm * 0.08));
  const intervalRepKm = 0.4; // 400m reps
  const intervalReps = Math.min(8, Math.max(4, Math.round(weeklyKm * 0.012)));
  const tempoTotalKm = 1.5 + tempoWorkKm + 1.0; // warmup + work + cooldown
  const intervalTotalKm =
    1.5 + intervalReps * intervalRepKm + 1.0; // warmup + work + cooldown

  remainingKm -=
    tempoCount * tempoTotalKm + intervalCount * intervalTotalKm;

  const minEasy = easyRunMinKm > 0 ? easyRunMinKm : 4;
  const easyKm = easyCount > 0 ? Math.max(minEasy, Math.round(remainingKm / easyCount)) : 0;

  for (const [day, type] of typeMap) {
    if (type === "long") {
      distMap.set(day, longRunKm);
    } else if (type === "easy" || type === "recovery") {
      distMap.set(day, easyKm);
    } else if (type === "tempo") {
      distMap.set(day, tempoWorkKm); // stored as work km, total computed in workout builder
    } else if (type === "interval") {
      // Store as [reps, repKm] encoded — we'll decode in the week builder
      distMap.set(day, intervalReps * 1000 + intervalRepKm * 100); // encoding trick
    } else if (type === "race") {
      distMap.set(day, raceDistanceKm(raceDistance));
    } else {
      distMap.set(day, 0);
    }
  }

  return distMap;
}

// ── Week builder ─────────────────────────────────────────────────────────────

function buildWeek(
  weekNumber: number,
  weekStartDate: Date,
  phase: WeekPhase,
  type: WeekType,
  targetKm: number,
  config: PlanConfig,
  paces: PaceZones
): GeneratedWeek {
  const trainingDays = pickTrainingDays(
    config.daysPerWeek,
    config.preferredLongRunDay
  );

  const qualityDays = QUALITY_DAYS[config.trainingDifficulty];
  const typeMap = assignWorkoutTypes(
    trainingDays,
    phase,
    type,
    config.preferredLongRunDay,
    qualityDays,
    config.trainingDifficulty
  );

  const distMap = distributeVolume(
    targetKm,
    typeMap,
    config.longRunCapKm,
    config.raceDistance,
    config.easyRunMinKm ?? 0
  );

  const workouts: GeneratedWorkout[] = [];
  let sortOrder = 0;

  // weekStartDate is always Monday.
  // Iterate Mon(1), Tue(2), ..., Sat(6), Sun(0) so week starts on Monday.
  const dayOrder = [1, 2, 3, 4, 5, 6, 0]; // Mon-first

  // Generate all 7 days
  for (const dow of dayOrder) {
    const dayOffset = dow === 0 ? 6 : dow - 1; // Mon=0 offset, Tue=1, ..., Sun=6
    const date = addDays(weekStartDate, dayOffset);
    const workoutType = typeMap.get(dow);

    if (!workoutType) {
      // Rest day
      workouts.push(buildRestWorkout(dow, date, sortOrder++));
      continue;
    }

    const raw = distMap.get(dow) ?? 0;

    switch (workoutType) {
      case "easy":
      case "recovery": {
        workouts.push(
          buildEasyWorkout(dow, date, Math.max(4, raw), paces, config.hillyArea, sortOrder++)
        );
        break;
      }
      case "long": {
        workouts.push(
          buildLongRunWorkout(dow, date, raw, paces, config.hillyArea, sortOrder++)
        );
        break;
      }
      case "tempo": {
        workouts.push(
          buildTempoWorkout(dow, date, Math.max(3, raw), paces, config.hillyArea, sortOrder++)
        );
        break;
      }
      case "interval": {
        // Decode reps and repKm
        const reps = Math.floor(raw / 1000);
        const repKm = ((raw % 1000) / 100);
        workouts.push(
          buildIntervalWorkout(
            dow,
            date,
            Math.max(4, reps),
            repKm || 0.4,
            paces,
            config.hillyArea,
            sortOrder++
          )
        );
        break;
      }
      case "race": {
        workouts.push(
          buildRaceWorkout(dow, date, config, paces, sortOrder++)
        );
        break;
      }
      case "rest": {
        workouts.push(buildRestWorkout(dow, date, sortOrder++));
        break;
      }
    }
  }

  return {
    weekNumber,
    phase,
    type,
    targetKm: Math.round(targetKm),
    workouts,
  };
}

// ── Main generator ───────────────────────────────────────────────────────────

/**
 * Generate a complete training plan from a PlanConfig.
 *
 * @param config - Plan configuration
 * @returns GeneratedPlan ready for DB insertion
 */
export function generatePlan(config: PlanConfig): GeneratedPlan {
  // Validate inputs
  if (config.daysPerWeek < 3 || config.daysPerWeek > 6) {
    throw new Error("daysPerWeek must be between 3 and 6");
  }
  if (config.goalTimeSeconds <= 0) {
    throw new Error("goalTimeSeconds must be positive");
  }
  if (config.raceDate <= config.startDate) {
    throw new Error("raceDate must be after startDate");
  }

  // Calculate VDOT
  const distM = raceDistanceMeters(config.raceDistance);
  const { vdot } = calculateVdot(distM, config.goalTimeSeconds);

  // Derive pace zones
  const paces = getPaceZones(vdot);

  // Calculate plan length in weeks
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const totalWeeks = Math.max(
    4,
    Math.round(
      (config.raceDate.getTime() - config.startDate.getTime()) / msPerWeek
    )
  );

  // Build phase map
  const phases = buildPhaseMap(totalWeeks);

  // Build volume progression
  const volumes = buildVolumeProgression(config, phases, totalWeeks);

  // Generate weeks
  const weeks: GeneratedWeek[] = [];
  for (let i = 0; i < totalWeeks; i++) {
    const weekNumber = i + 1;
    const phase = phases[i];
    const type = weekType(i, totalWeeks, phase);
    const targetKm = volumes[i];
    // Week starts on the startDate offset by i weeks
    const weekStartDate = addDays(config.startDate, i * 7);

    weeks.push(
      buildWeek(weekNumber, weekStartDate, phase, type, targetKm, config, paces)
    );
  }

  // Plan name
  const name = `${raceLabel(config.raceDistance)} — ${formatTime(config.goalTimeSeconds)} Goal`;

  return {
    name,
    raceDistance: config.raceDistance,
    goalTimeSeconds: config.goalTimeSeconds,
    vdot: Math.round(vdot * 10) / 10,
    startDate: config.startDate,
    raceDate: config.raceDate,
    planLengthWeeks: totalWeeks,
    daysPerWeek: config.daysPerWeek,
    preferredLongRunDay: config.preferredLongRunDay,
    currentWeeklyKm: config.currentWeeklyKm,
    trainingVolume: config.trainingVolume,
    trainingDifficulty: config.trainingDifficulty,
    longRunCapKm: config.longRunCapKm,
    hillyArea: config.hillyArea,
    weeks,
  };
}

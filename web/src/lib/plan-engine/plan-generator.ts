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

import { calculateVdot, predictRaceTime, RACE_DISTANCES_M } from "./vdot";
import { getPaceZones } from "./pace-zones";
import type {
  PlanConfig,
  PlanIntent,
  RunnerLevel,
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

/**
 * Compute peak weekly km from current weekly km and race distance.
 * Peak is typically 1.4–2x starting volume depending on race distance.
 * Minimum peaks ensure enough volume for the race distance.
 */
const MIN_PEAK_KM: Record<string, number> = {
  "5k": 25,
  "10k": 35,
  "half": 45,
  "marathon": 55,
  "ultra": 70,
};

/** Peak-volume scaling per training-volume preference */
const VOLUME_FACTOR: Record<string, number> = {
  beginner: 0.75,
  low: 0.85,
  medium: 1.0,
  high: 1.15,
  elite: 1.3,
};

function computePeakKm(
  currentWeeklyKm: number,
  raceDistance: string,
  trainingVolume: string
): number {
  // Multiplier: longer races need higher peak relative to start
  const multiplier: Record<string, number> = {
    "5k": 1.4,
    "10k": 1.5,
    "half": 1.6,
    "marathon": 1.8,
    "ultra": 2.0,
  };
  const mult = multiplier[raceDistance] ?? 1.5;
  const factor = VOLUME_FACTOR[trainingVolume] ?? 1.0;
  const computed = Math.round(currentWeeklyKm * mult * factor);
  const minPeak = Math.round((MIN_PEAK_KM[raceDistance] ?? 30) * factor);
  return Math.max(computed, minPeak);
}

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

/** The plan's race distance in metres, honouring a "custom" km value. */
function planDistanceMeters(config: PlanConfig): number {
  if (config.raceDistance === "custom") {
    return Math.max(0, (config.customDistanceKm ?? 0) * 1000);
  }
  return raceDistanceMeters(config.raceDistance);
}

/** Display label for a plan's distance, honouring "custom". */
function planDistanceLabel(config: PlanConfig): string {
  if (config.raceDistance === "custom") {
    const km = Math.round((config.customDistanceKm ?? 0) * 10) / 10;
    return `${km} km`;
  }
  return raceLabel(config.raceDistance);
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
    ultra: "Ultra (50K)",
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
  const startKm = Math.max(config.currentWeeklyKm, 10); // minimum 10km/week start
  const peakKm = computePeakKm(
    config.currentWeeklyKm,
    config.raceDistance,
    config.trainingVolume
  );

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
  // Alternating tempo/steady segments for variety
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
  // Varied rep distances (descending ladder or mixed)
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
  // Resolve the real distance (custom distances aren't in RACE_DISTANCES_M —
  // using the enum lookup would give 0 km → an Infinity pace that fails the
  // integer DB column and 500s the whole plan save).
  const distKm = planDistanceMeters(config) / 1000;
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
      targetPaceSecKm: distKm > 0 ? Math.round(config.goalTimeSeconds / distKm) : paces.M.targetPaceSecKm,
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
    description: "Easy, conversational pace — you should be able to chat the whole way.",
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
    description: `Warm up 1.5 km easy, then ${workKm} km comfortably hard — the fastest pace you could hold for about an hour — then 1 km easy to finish.`,
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
    description: `Warm up 1.5 km, then ${reps} × ${repKm * 1000} m hard but controlled (about 5K race effort) with a 90s easy jog between each, then 1 km easy.`,
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
  const distKm = planDistanceMeters(config) / 1000;
  return {
    dayOfWeek,
    date,
    type: "race",
    title: `Race Day — ${planDistanceLabel(config)}`,
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
/**
 * Predefined optimal day patterns that spread workouts evenly with rest between.
 * Days are Mon=1...Sat=6, Sun=0. Long run day is placed at preferredLongRunDay.
 * These patterns maximize spacing between workouts.
 */
const DAY_PATTERNS: Record<number, number[][]> = {
  2: [[3, 6]], // Wed, Sat — maximum recovery between the two runs
  3: [[1, 3, 6]], // Mon, Wed, Sat — 1 rest between each
  4: [[1, 3, 5, 0]], // Mon, Wed, Fri, Sun — alternating
  5: [[1, 2, 4, 5, 0]], // Mon, Tue, Thu, Fri, Sun — 2 on, 1 off pattern
  6: [[1, 2, 3, 4, 5, 0]], // Mon-Fri + Sun
};

function pickTrainingDays(
  daysPerWeek: number,
  preferredLongRunDay: number
): number[] {
  if (daysPerWeek < 1 || daysPerWeek > 7) {
    throw new Error("daysPerWeek must be between 1 and 7");
  }

  if (daysPerWeek === 7) {
    return [1, 2, 3, 4, 5, 6, 0]; // Mon-Sun
  }

  // Use predefined pattern, then rotate to include preferred long run day
  const patterns = DAY_PATTERNS[daysPerWeek];
  if (!patterns) {
    // Fallback: evenly space days
    const result: number[] = [];
    const gap = 7 / daysPerWeek;
    for (let i = 0; i < daysPerWeek; i++) {
      result.push(Math.round((preferredLongRunDay + i * gap) % 7));
    }
    return result.sort((a, b) => {
      const ma = a === 0 ? 7 : a;
      const mb = b === 0 ? 7 : b;
      return ma - mb;
    });
  }

  const base = patterns[0];

  // Check if preferred long run day is already in the pattern
  if (base.includes(preferredLongRunDay)) {
    return [...base].sort((a, b) => {
      const ma = a === 0 ? 7 : a;
      const mb = b === 0 ? 7 : b;
      return ma - mb;
    });
  }

  // Swap: replace the day closest to preferred long run day with it
  const result = [...base];
  let bestIdx = 0;
  let bestDist = 99;
  for (let i = 0; i < result.length; i++) {
    const d = result[i];
    const dist = Math.min(Math.abs(d - preferredLongRunDay), 7 - Math.abs(d - preferredLongRunDay));
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  result[bestIdx] = preferredLongRunDay;

  // Sort Monday-first
  return result.sort((a, b) => {
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
    // Race week: race is the LAST workout. Only light easy runs before it.
    // Race day is determined by raceDate in the week builder, not here.
    // We use preferredLongRunDay as race day placeholder.
    const raceDow = preferredLongRunDay;

    for (const day of trainingDays) {
      // Monday-first ordering: Mon=1..Sat=6,Sun=0 → normalize for comparison
      const dayNorm = day === 0 ? 7 : day;
      const raceNorm = raceDow === 0 ? 7 : raceDow;

      if (day === raceDow) {
        map.set(day, "race");
      } else if (dayNorm < raceNorm) {
        // Before race: light easy run
        map.set(day, "easy");
      }
      // After race: no workout (rest)
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

  // Long run gets 35-40% of weekly volume — it must be the distinctly longest run
  let longRunKm = Math.round(weeklyKm * 0.38);
  if (longRunCapKm > 0) {
    longRunKm = Math.min(longRunKm, longRunCapKm);
  }
  // Long run should not exceed 2.5x race distance for shorter races
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

  const minEasy = easyRunMinKm > 0 ? easyRunMinKm : 3;
  // Preferred easy-run size: distinctly shorter than the long run (≈55%, and at
  // least 3km shorter). This is only a *preference*, not a hard ceiling.
  const preferredMaxEasy = Math.min(
    Math.round(longRunKm * 0.55),
    longRunKm - 3
  );
  // easyRunMinKm is a FLOOR, not a ceiling — easy runs may run longer. When the
  // weekly volume can't fit under the preferred size (few training days, or a
  // binding long-run cap), let the easy runs grow to absorb it rather than
  // silently discarding volume. They stay 1km under the long run so it remains
  // the distinctly longest run of the week.
  const wouldStrandVolume = remainingKm > easyCount * preferredMaxEasy;
  const maxEasy = wouldStrandVolume
    ? Math.max(preferredMaxEasy, longRunKm - 1)
    : preferredMaxEasy;
  const effectiveMaxEasy = Math.max(maxEasy, minEasy);

  // Only reduce easy run count in extreme cases: when the user's minimum
  // easy run makes it impossible to distribute volume at all
  // (e.g. 15km week with minEasy=10 and 3 easy runs = 30km needed, impossible)
  let actualEasyCount = easyCount;
  if (easyRunMinKm > 0 && easyCount > 0 && remainingKm > 0) {
    const totalMinNeeded = easyRunMinKm * easyCount;
    if (totalMinNeeded > remainingKm * 1.5) {
      // Extreme: minimum exceeds 150% of available — drop runs
      actualEasyCount = Math.max(1, Math.floor(remainingKm / easyRunMinKm));
      let toRemove = easyCount - actualEasyCount;
      for (const [day, type] of typeMap) {
        if (toRemove <= 0) break;
        if (type === "easy" || type === "recovery") {
          typeMap.set(day, "rest");
          toRemove--;
        }
      }
    }
  }

  const rawEasyKm = actualEasyCount > 0 ? Math.round(remainingKm / actualEasyCount) : 0;
  const easyKm = Math.max(minEasy, Math.min(rawEasyKm, effectiveMaxEasy));

  // If capping easy runs frees up km, add it to the long run (up to cap)
  const freedKm = actualEasyCount > 0 ? Math.max(0, rawEasyKm - easyKm) * actualEasyCount : 0;
  if (freedKm > 0) {
    const newLong = longRunKm + freedKm;
    longRunKm = longRunCapKm > 0 ? Math.min(newLong, longRunCapKm) : newLong;
  }

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

/** Monday-first sort for JS weekdays (Sun=0 treated as 7). */
function sortMondayFirst(days: number[]): number[] {
  return [...days].sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b));
}

/** Sanitize an explicit available-days set: valid weekdays, deduped, Mon-first. */
function normalizeAvailableDays(days: number[] | null | undefined): number[] | null {
  if (!days || days.length === 0) return null;
  const clean = [...new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
  return clean.length >= 2 ? sortMondayFirst(clean) : null;
}

/** Circular distance between two JS weekdays on the 7-day cycle. */
function circularDayGap(a: number, b: number): number {
  const diff = Math.abs(a - b) % 7;
  return Math.min(diff, 7 - diff);
}

/**
 * Pick the best-spaced subset of exactly `count` days from `available`,
 * always including `longRunDay`. Deterministic greedy: repeatedly add the
 * candidate whose minimum circular gap to the already-chosen days is largest,
 * breaking ties Monday-first. When `available` has `count` or fewer days it
 * is returned unchanged (equal-length behavior identical to before).
 */
function selectTrainingSubset(
  available: number[],
  count: number,
  longRunDay: number
): number[] {
  if (available.length <= count) return available;

  const chosen: number[] = [longRunDay];
  const pool = sortMondayFirst(available.filter((d) => d !== longRunDay));

  while (chosen.length < count && pool.length > 0) {
    let bestIdx = 0;
    let bestScore = -1;
    for (let i = 0; i < pool.length; i++) {
      const score = Math.min(...chosen.map((c) => circularDayGap(pool[i], c)));
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    chosen.push(pool.splice(bestIdx, 1)[0]);
  }

  return sortMondayFirst(chosen);
}

function buildWeek(
  weekNumber: number,
  weekStartDate: Date,
  phase: WeekPhase,
  type: WeekType,
  targetKm: number,
  config: PlanConfig,
  paces: PaceZones,
  skipBeforeDate?: Date
): GeneratedWeek {
  // Explicit availability wins: schedule ONLY on the user's chosen days.
  // Otherwise keep the legacy derived spacing patterns.
  const explicitDays = normalizeAvailableDays(config.availableDays);

  // Long run must land on a chosen day. Fall back to the latest available day
  // of the week (Mon-first) if the preferred day isn't in the set.
  const longRunDay =
    explicitDays && !explicitDays.includes(config.preferredLongRunDay)
      ? explicitDays[explicitDays.length - 1]
      : config.preferredLongRunDay;

  // When the user offered more days than runs per week, pick the best-spaced
  // subset (always including the long-run day). Equal lengths pass through.
  const trainingDays = explicitDays
    ? selectTrainingSubset(explicitDays, config.daysPerWeek, longRunDay)
    : pickTrainingDays(config.daysPerWeek, config.preferredLongRunDay);

  const qualityDays = QUALITY_DAYS[config.trainingDifficulty];
  // For race week, use the actual race date's day of week (race intent only).
  const raceDayOfWeek = config.raceDate ? config.raceDate.getDay() : longRunDay; // 0=Sun...6=Sat
  const longOrRaceDay = type === "race" ? raceDayOfWeek : longRunDay;

  // For race week, ensure the race day is in the training days
  let effectiveTrainingDays = trainingDays;
  if (type === "race" && !trainingDays.includes(raceDayOfWeek)) {
    effectiveTrainingDays = [...trainingDays.filter((d) => d !== trainingDays[trainingDays.length - 1]), raceDayOfWeek];
    effectiveTrainingDays.sort((a, b) => { const ma = a === 0 ? 7 : a; const mb = b === 0 ? 7 : b; return ma - mb; });
  }

  const typeMap = assignWorkoutTypes(
    effectiveTrainingDays,
    phase,
    type,
    longOrRaceDay,
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

    // Skip days before the actual plan start (partial first week)
    if (skipBeforeDate && date < skipBeforeDate) {
      continue; // Don't generate any workout/rest for days before plan start
    }

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

  // Reconcile the week's displayed volume with what was actually scheduled.
  // Hard caps (long-run cap, easy min/max, limited training days) can make the
  // achievable total differ from the ramp target — the weekly number shown to
  // the athlete must equal the sum of the runs actually on the calendar, or the
  // header "total/max km" won't match the schedule.
  const scheduledKm = workouts.reduce((sum, w) => sum + (w.targetKm ?? 0), 0);

  return {
    weekNumber,
    phase,
    type,
    targetKm: Math.round(scheduledKm),
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

/** Date-only comparison, so a midnight-anchored day still counts as "today". */
function sameOrAfterDay(a: Date, b: Date): boolean {
  const da = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const db = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return da >= db;
}

/**
 * Decides where week 1 sits, and whether it is a partial week.
 *
 * Starting mid-week gives a partial first week: only the selected run days that
 * still lie ahead, so the week carries less mileage than planned. That is
 * intended. What is not intended is a first week with NO runs left in it — that
 * renders as an empty training week, gets backfilled by the strength schedule
 * alone, and makes an N-week plan effectively N-1. When no selected run day
 * remains, week 1 starts on the following Monday as a full week instead.
 */
function resolveWeekOneAnchor(
  startDate: Date,
  availableDays: number[] | null | undefined
): { planStartMonday: Date; skipBeforeDate: Date | undefined } {
  const startDow = startDate.getDay(); // 0=Sun
  const mondayOffset = startDow === 0 ? -6 : 1 - startDow;
  const weekMonday = addDays(startDate, mondayOffset);

  const runDays = normalizeAvailableDays(availableDays) ?? [];
  const anyRunDayLeft = runDays.some((dow) => {
    const offset = dow === 0 ? 6 : dow - 1;
    return sameOrAfterDay(addDays(weekMonday, offset), startDate);
  });

  return anyRunDayLeft
    ? { planStartMonday: weekMonday, skipBeforeDate: startDate }
    : { planStartMonday: addDays(weekMonday, 7), skipBeforeDate: undefined };
}

export function generatePlan(config: PlanConfig): GeneratedPlan {
  // Validate inputs
  if (config.daysPerWeek < 2 || config.daysPerWeek > 6) {
    throw new Error("daysPerWeek must be between 2 and 6");
  }
  if (config.goalTimeSeconds <= 0) {
    throw new Error("goalTimeSeconds must be positive");
  }
  if (!config.raceDate) {
    throw new Error("raceDate is required for a race plan");
  }
  const raceDate = config.raceDate;
  if (raceDate <= config.startDate) {
    throw new Error("raceDate must be after startDate");
  }

  // Monday of week 1 — pushed to next Monday when no run day is left this week.
  const { planStartMonday, skipBeforeDate: weekOneSkip } = resolveWeekOneAnchor(
    config.startDate,
    config.availableDays
  );

  // Calculate VDOT
  const distM = planDistanceMeters(config);
  if (distM <= 0) {
    throw new Error("A custom race plan needs a positive distance");
  }
  const { vdot } = calculateVdot(distM, config.goalTimeSeconds);

  // Derive pace zones
  const paces = getPaceZones(vdot);

  // Plan length in weeks, counted so the race ALWAYS falls inside the final
  // week. Week i spans planStartMonday + (i-1)*7 … +6 days, so the race sits
  // in week floor(daysToRace / 7) + 1. Rounding here instead would end the
  // plan a week early whenever race day is Mon-Thu.
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysToRace = Math.round(
    (raceDate.getTime() - planStartMonday.getTime()) / msPerDay
  );
  const totalWeeks = Math.max(4, Math.floor(daysToRace / 7) + 1);

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
    // All weeks aligned to Monday
    const weekStartDate = addDays(planStartMonday, i * 7);

    // For week 1, skip days before the actual start date (partial week)
    const skipBeforeDate = i === 0 ? weekOneSkip : undefined;

    weeks.push(
      buildWeek(weekNumber, weekStartDate, phase, type, targetKm, config, paces, skipBeforeDate)
    );
  }

  // Plan name
  const name = `${planDistanceLabel(config)} — ${formatTime(config.goalTimeSeconds)} Goal`;

  return {
    name,
    intent: "race",
    raceDistance: config.raceDistance,
    customDistanceKm: config.customDistanceKm ?? null,
    goalTimeSeconds: config.goalTimeSeconds,
    vdot: Math.round(vdot * 10) / 10,
    startDate: config.startDate,
    raceDate,
    planLengthWeeks: totalWeeks,
    daysPerWeek: config.daysPerWeek,
    preferredLongRunDay: config.preferredLongRunDay,
    currentWeeklyKm: config.currentWeeklyKm,
    trainingVolume: config.trainingVolume,
    trainingDifficulty: config.trainingDifficulty,
    longRunCapKm: config.longRunCapKm,
    easyRunMinKm: config.easyRunMinKm ?? 0,
    hillyArea: config.hillyArea,
    availableDays: normalizeAvailableDays(config.availableDays),
    runnerLevel: config.runnerLevel ?? null,
    weeks,
  };
}

// ── Non-race ("steady") generator ─────────────────────────────────────────────
// Get-fit / maintain plans have no race day and no goal time. They reuse the
// exact same week builder (buildWeek) — so workouts, paces, days-per-week and
// availability all behave identically — but with a non-race phase/volume map
// (no peak, no taper, no race week) and paces derived from the athlete's
// self-reported level. The race generator above is left completely untouched.

/** Representative VDOT per self-reported level, used to derive training paces
 *  when there's no goal time. Roughly: easy pace 7:00 / 5:40 / 4:50 / 4:10 per km. */
const RUNNER_LEVEL_VDOT: Record<RunnerLevel, number> = {
  beginner: 32,
  intermediate: 42,
  advanced: 52,
  elite: 62,
};

export function vdotForRunnerLevel(level: RunnerLevel | null | undefined): number {
  return RUNNER_LEVEL_VDOT[level ?? "beginner"] ?? 40;
}

/** Phase per week for a steady plan: maintain = all base; get-fit ramps base→build
 *  for variety. Never peak/taper (those exist to sharpen for a race day). */
function steadyPhaseMap(weeks: number, intent: PlanIntent): WeekPhase[] {
  if (intent === "maintain") return Array(weeks).fill("base");
  const baseWeeks = Math.max(1, Math.round(weeks * 0.4));
  return Array.from({ length: weeks }, (_, i) => (i < baseWeeks ? "base" : "build"));
}

/** Deload every 4th week; never a race week. */
function steadyWeekType(weekIndex: number): WeekType {
  return (weekIndex + 1) % 4 === 0 ? "deload" : "normal";
}

/**
 * Flat volume for maintain; a gentle ≤10%/week ramp for get-fit. The weekly-
 * volume preference scales it (VOLUME_FACTOR): maintain holds near current×factor,
 * get-fit ramps from current up to +30%×factor — so Low/Normal/High actually
 * change the mileage instead of being inert.
 */
function steadyVolume(config: PlanConfig, weeks: number, intent: PlanIntent): number[] {
  const base = Math.max(config.currentWeeklyKm || 0, 10);
  const factor = VOLUME_FACTOR[config.trainingVolume] ?? 1.0;
  const level = Math.max(5, Math.round(base * factor)); // maintain flat level
  const start = intent === "maintain" ? level : base;
  const cap = intent === "maintain" ? level : Math.round(base * 1.3 * factor);
  const volumes: number[] = [];
  let lastNormal = start;
  for (let i = 0; i < weeks; i++) {
    const deload = steadyWeekType(i) === "deload";
    const target = intent === "maintain" ? level : Math.min(lastNormal * 1.1, cap);
    if (deload) {
      volumes.push(Math.round(target * 0.7));
    } else {
      lastNormal = Math.round(target);
      volumes.push(lastNormal);
    }
  }
  return volumes;
}

export function generateSteadyPlan(config: PlanConfig): GeneratedPlan {
  if (config.daysPerWeek < 2 || config.daysPerWeek > 6) {
    throw new Error("daysPerWeek must be between 2 and 6");
  }
  const intent: PlanIntent = config.intent === "maintain" ? "maintain" : "get_fit";
  const weeks = config.planLengthWeeks ?? 8;
  if (weeks < 4 || weeks > 26) {
    throw new Error("planLengthWeeks must be between 4 and 26");
  }

  const { planStartMonday, skipBeforeDate: weekOneSkip } = resolveWeekOneAnchor(
    config.startDate,
    config.availableDays
  );
  const planEnd = addDays(planStartMonday, weeks * 7 - 1); // last Sunday

  const vdot = vdotForRunnerLevel(config.runnerLevel);
  const paces = getPaceZones(vdot);
  const phases = steadyPhaseMap(weeks, intent);
  const volumes = steadyVolume(config, weeks, intent);

  // buildWeek/distributeVolume need a reference race distance for interval/long
  // sizing and never trigger the race-day branch (no week is type "race"). 10k
  // is a neutral mid reference; raceDate is set to the plan end so downstream
  // consumers that read it show "days left in plan", not a real race.
  const refConfig: PlanConfig = { ...config, raceDistance: "10k", raceDate: planEnd };

  const weeksOut: GeneratedWeek[] = [];
  for (let i = 0; i < weeks; i++) {
    const weekStartDate = addDays(planStartMonday, i * 7);
    const skipBeforeDate = i === 0 ? weekOneSkip : undefined;
    weeksOut.push(
      buildWeek(i + 1, weekStartDate, phases[i], steadyWeekType(i), volumes[i], refConfig, paces, skipBeforeDate)
    );
  }

  const goalTimeSeconds = Math.round(predictRaceTime(vdot, RACE_DISTANCES_M["10k"]));
  const name = intent === "maintain" ? `Maintain — ${weeks} weeks` : `Get Fit — ${weeks} weeks`;

  return {
    name,
    intent,
    raceDistance: "10k",
    goalTimeSeconds,
    vdot: Math.round(vdot * 10) / 10,
    startDate: config.startDate,
    raceDate: planEnd,
    planLengthWeeks: weeks,
    daysPerWeek: config.daysPerWeek,
    preferredLongRunDay: config.preferredLongRunDay,
    currentWeeklyKm: config.currentWeeklyKm,
    trainingVolume: config.trainingVolume,
    trainingDifficulty: config.trainingDifficulty,
    longRunCapKm: config.longRunCapKm,
    easyRunMinKm: config.easyRunMinKm ?? 0,
    hillyArea: config.hillyArea,
    availableDays: normalizeAvailableDays(config.availableDays),
    runnerLevel: config.runnerLevel ?? null,
    weeks: weeksOut,
  };
}

// ── Return-to-running generator ───────────────────────────────────────────────
// A conservative run/walk progression for coming back from injury or illness.
// Each stage is one session's structure; the plan walks from mostly-walking to
// continuous running across its weeks, with a consolidation ("hold") week every
// 4th week. Sessions are easy-effort only and deliberately capped — the guiding
// rule, stated on every workout, is to stop and walk on any pain. This pairs
// with the app's existing readiness score and pain check-ins.

const RTR_STAGES: { run: number; walk: number; reps: number }[] = [
  { run: 1, walk: 2, reps: 8 }, // ~24 min, mostly walking
  { run: 2, walk: 2, reps: 6 },
  { run: 3, walk: 2, reps: 5 },
  { run: 5, walk: 2, reps: 4 },
  { run: 8, walk: 2, reps: 3 },
  { run: 10, walk: 1, reps: 3 },
  { run: 15, walk: 1, reps: 2 },
  { run: 25, walk: 0, reps: 1 }, // continuous easy run
];

// A consolidation ("hold") week repeats the prior week's stage rather than
// advancing — a safety pause. Every 4th week, EXCEPT the final week, which
// always graduates to the top (continuous-running) stage.
function isRtrHoldWeek(weekIdx: number, weeks: number): boolean {
  return weekIdx > 0 && weekIdx !== weeks - 1 && (weekIdx + 1) % 4 === 0;
}

function rtrStageForWeek(weekIdx: number, weeks: number) {
  const effIdx = isRtrHoldWeek(weekIdx, weeks) ? weekIdx - 1 : weekIdx;
  const denom = Math.max(1, weeks - 1);
  const stage = Math.round((effIdx / denom) * (RTR_STAGES.length - 1));
  return RTR_STAGES[Math.min(Math.max(stage, 0), RTR_STAGES.length - 1)];
}

function buildReturnWorkout(
  dayOfWeek: number,
  date: Date,
  stage: { run: number; walk: number; reps: number },
  paces: PaceZones,
  sortOrder: number
): GeneratedWorkout {
  const { run, walk, reps } = stage;
  const runMin = run * reps;
  const totalMin = (run + walk) * reps;
  const easyPace = paces.E.targetPaceSecKm;
  // Distance counts running time only (walking barely moves the needle).
  const km = Math.round(((runMin * 60) / easyPace) * 10) / 10;
  const continuous = walk === 0;
  const title = continuous ? `Easy Run ${run} min` : `Run/Walk ${run}/${walk} × ${reps}`;
  const description = continuous
    ? `Continuous easy run — ${run} min at a relaxed, conversational pace. Stop and walk if anything hurts.`
    : `${reps} × (${run} min easy run, ${walk} min walk). Keep the runs relaxed — stop and walk if you feel pain. No single session is worth a setback.`;
  return {
    dayOfWeek,
    date,
    type: "easy",
    title,
    description,
    targetKm: km,
    targetDurationMinutes: totalMin,
    sortOrder,
    blocks: [
      {
        sortOrder: 0,
        type: "work",
        durationMinutes: totalMin,
        targetPaceSecKm: easyPace,
        minPaceSecKm: paces.E.minPaceSecKm,
        maxPaceSecKm: paces.E.maxPaceSecKm,
      },
    ],
  };
}

export function generateReturnPlan(config: PlanConfig): GeneratedPlan {
  if (config.daysPerWeek < 2 || config.daysPerWeek > 6) {
    throw new Error("daysPerWeek must be between 2 and 6");
  }
  const weeks = config.planLengthWeeks ?? 8;
  if (weeks < 4 || weeks > 16) {
    throw new Error("planLengthWeeks must be between 4 and 16 for a return plan");
  }

  const { planStartMonday, skipBeforeDate: weekOneSkip } = resolveWeekOneAnchor(
    config.startDate,
    config.availableDays
  );
  const planEnd = addDays(planStartMonday, weeks * 7 - 1);

  const vdot = vdotForRunnerLevel(config.runnerLevel);
  const paces = getPaceZones(vdot);
  const explicitDays = normalizeAvailableDays(config.availableDays);
  // Return training is never daily — cap at 4 sessions/week.
  const sessionsPerWeek = Math.min(config.daysPerWeek, 4);

  const weeksOut: GeneratedWeek[] = [];
  for (let i = 0; i < weeks; i++) {
    const stage = rtrStageForWeek(i, weeks);
    const weekStartDate = addDays(planStartMonday, i * 7);
    const longRunDay =
      explicitDays && !explicitDays.includes(config.preferredLongRunDay)
        ? explicitDays[explicitDays.length - 1]
        : config.preferredLongRunDay;
    const trainingDays = explicitDays
      ? selectTrainingSubset(explicitDays, sessionsPerWeek, longRunDay)
      : pickTrainingDays(sessionsPerWeek, config.preferredLongRunDay);
    const skipBeforeDate = i === 0 ? weekOneSkip : undefined;

    const workouts: GeneratedWorkout[] = [];
    let sortOrder = 0;
    for (const dow of [1, 2, 3, 4, 5, 6, 0]) {
      const dayOffset = dow === 0 ? 6 : dow - 1;
      const date = addDays(weekStartDate, dayOffset);
      if (skipBeforeDate && date < skipBeforeDate) continue;
      if (trainingDays.includes(dow)) {
        workouts.push(buildReturnWorkout(dow, date, stage, paces, sortOrder++));
      } else {
        workouts.push(buildRestWorkout(dow, date, sortOrder++));
      }
    }

    const targetKm = Math.round(workouts.reduce((s, w) => s + (w.targetKm ?? 0), 0));
    weeksOut.push({
      weekNumber: i + 1,
      phase: "base",
      type: isRtrHoldWeek(i, weeks) ? "deload" : "normal",
      targetKm,
      workouts,
    });
  }

  const goalTimeSeconds = Math.round(predictRaceTime(vdot, RACE_DISTANCES_M["10k"]));

  return {
    name: `Return to Running — ${weeks} weeks`,
    intent: "return",
    raceDistance: "10k",
    goalTimeSeconds,
    vdot: Math.round(vdot * 10) / 10,
    startDate: config.startDate,
    raceDate: planEnd,
    planLengthWeeks: weeks,
    daysPerWeek: sessionsPerWeek,
    preferredLongRunDay: config.preferredLongRunDay,
    currentWeeklyKm: config.currentWeeklyKm,
    trainingVolume: config.trainingVolume,
    trainingDifficulty: config.trainingDifficulty,
    longRunCapKm: config.longRunCapKm,
    easyRunMinKm: config.easyRunMinKm ?? 0,
    hillyArea: config.hillyArea,
    availableDays: normalizeAvailableDays(config.availableDays),
    runnerLevel: config.runnerLevel ?? null,
    weeks: weeksOut,
  };
}

/** Dispatch to the right generator based on intent (defaults to race). */
export function generatePlanForConfig(config: PlanConfig): GeneratedPlan {
  if (config.intent === "return") return generateReturnPlan(config);
  if (config.intent && config.intent !== "race") return generateSteadyPlan(config);
  return generatePlan(config);
}

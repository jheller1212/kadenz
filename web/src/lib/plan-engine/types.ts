export type RaceDistance = "5k" | "10k" | "half" | "marathon";

/** A pace zone with min/target/max in seconds per km */
export interface PaceZone {
  minPaceSecKm: number;
  targetPaceSecKm: number;
  maxPaceSecKm: number;
}

/** All training pace zones derived from a VDOT */
export interface PaceZones {
  /** Easy / conversational */
  E: PaceZone;
  /** Marathon pace */
  M: PaceZone;
  /** Threshold / tempo */
  T: PaceZone;
  /** Interval (VO2max) */
  I: PaceZone;
  /** Repetition (speed, supra-max) */
  R: PaceZone;
}

/** Heart-rate zone expressed as bpm range */
export interface HrZone {
  min: number;
  max: number;
}

/** Five Karvonen heart-rate zones */
export interface HrZones {
  z1: HrZone;
  z2: HrZone;
  z3: HrZone;
  z4: HrZone;
  z5: HrZone;
}

export interface VdotResult {
  vdot: number;
  /** %VO2max at which the race was run */
  pctVO2max: number;
}

// ── Plan Generator Types ──────────────────────────────────────────────────────

export type TrainingVolume = "beginner" | "low" | "medium" | "high" | "elite";
export type TrainingDifficulty = "easy" | "moderate" | "hard";
export type RaceElevation = "flat" | "rolling" | "hilly" | "mountainous";
export type WeekPhase = "base" | "build" | "peak" | "taper";
export type WeekType = "normal" | "deload" | "race";
export type WorkoutType =
  | "easy"
  | "long"
  | "tempo"
  | "interval"
  | "recovery"
  | "race"
  | "rest";
export type BlockType = "warmup" | "work" | "recovery" | "cooldown";

export interface PlanConfig {
  /** Race distance */
  raceDistance: RaceDistance;
  /** Goal finish time in seconds */
  goalTimeSeconds: number;
  /** Plan start date (Monday of week 1) */
  startDate: Date;
  /** Race date */
  raceDate: Date;
  /** Training days per week (3–6) */
  daysPerWeek: number;
  /** Overall volume preference */
  trainingVolume: TrainingVolume;
  /** Workout intensity preference */
  trainingDifficulty: TrainingDifficulty;
  /** Preferred day for long run (0=Sun … 6=Sat) */
  preferredLongRunDay: number;
  /** Whether the athlete trains in a hilly area */
  hillyArea: boolean;
  /** Race elevation profile */
  raceElevation: RaceElevation;
  /** Current weekly mileage (km) — baseline for ramp-up */
  currentWeeklyKm: number;
  /** Hard cap on long-run distance (km); 0 = no cap */
  longRunCapKm: number;
  /** Minimum easy run distance (km); 0 = no minimum */
  easyRunMinKm: number;
}

export interface GeneratedBlock {
  sortOrder: number;
  type: BlockType;
  durationMinutes?: number;
  distanceKm?: number;
  targetPaceSecKm?: number;
  minPaceSecKm?: number;
  maxPaceSecKm?: number;
  reps?: number;
  repDistanceKm?: number;
  repRestSeconds?: number;
}

export interface GeneratedWorkout {
  /** DB id — present when the workout was loaded from a saved plan. */
  id?: string;
  dayOfWeek: number; // 0=Sun … 6=Sat
  date: Date;
  type: WorkoutType;
  title: string;
  description?: string;
  targetKm?: number;
  targetDurationMinutes?: number;
  sortOrder: number;
  blocks: GeneratedBlock[];
}

export interface GeneratedWeek {
  weekNumber: number; // 1-based
  phase: WeekPhase;
  type: WeekType;
  targetKm: number;
  workouts: GeneratedWorkout[];
}

export interface GeneratedPlan {
  /** Plan name derived from goal */
  name: string;
  raceDistance: RaceDistance;
  goalTimeSeconds: number;
  vdot: number;
  startDate: Date;
  raceDate: Date;
  planLengthWeeks: number;
  daysPerWeek: number;
  preferredLongRunDay: number;
  currentWeeklyKm: number;
  trainingVolume: TrainingVolume;
  trainingDifficulty: TrainingDifficulty;
  longRunCapKm: number;
  hillyArea: boolean;
  weeks: GeneratedWeek[];
}

// ── Strength module domain types ─────────────────────────────────────────────

export type StrengthCategory = "upper" | "lower" | "achilles" | "full_body";
export type StrengthSessionType = "upper" | "lower" | "lower_achilles" | "upper_achilles" | "achilles" | "full_body";
export type PainTiming = "during" | "after" | "next_day";

// Role within an Achilles session — drives the "explosive first, slow heavy
// after" ordering rule.
export type AchillesRole = "explosive" | "slow_heavy" | null;

/** A single exercise definition (seed catalogue + template metadata). */
export interface ExerciseDef {
  slug: string;
  name: string;
  category: StrengthCategory;
  equipmentNote?: string;
  tempoNote?: string;
  flatGroundOnly?: boolean;
  slowProgressor?: boolean;
  defaultSets?: number;
  repLow?: number;
  repHigh?: number;
  /** Suggested start load per dumbbell (kg); undefined = bodyweight to start. */
  startWeightKg?: number;
  /** Ordering role inside an Achilles block. */
  achillesRole?: AchillesRole;
}

/** A prescribed slot in a session template. */
export interface TemplateSlot {
  exerciseSlug: string;
  sets: number;
  repLow: number;
  repHigh: number;
  restSeconds: number;
  /** Loaded per hand/leg rather than a matched pair, when relevant. */
  perSide?: boolean;
}

export interface SessionTemplate {
  type: StrengthSessionType;
  title: string;
  targetDurationMinutes: number;
  effortNote?: string;
  slots: TemplateSlot[];
}

/** A logged set as returned to progression/history logic. */
export interface LoggedSet {
  exerciseId?: string;
  exerciseSlug?: string;
  setNumber: number;
  weightKg: number | null;
  reps: number | null;
  rpe?: number | null;
}

/** A prior session's sets for one exercise, newest-first by session date. */
export interface ExerciseSessionHistory {
  sessionId: string;
  date: Date;
  sets: LoggedSet[];
}

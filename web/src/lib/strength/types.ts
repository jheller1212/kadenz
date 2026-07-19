// ── Strength module domain types ─────────────────────────────────────────────

export type StrengthCategory = "upper" | "lower" | "achilles" | "full_body";

/** Equipment an exercise needs. Absent/empty = bodyweight + floor only. */
export type Equipment =
  | "dumbbell"
  | "barbell"
  | "bench"
  | "chair"
  | "box"
  | "kettlebell"
  | "pullup_bar"
  | "band";
/** Every schedulable strength session type — the one list all schemas use. */
export const STRENGTH_SESSION_TYPES = [
  "upper",
  "lower",
  "lower_achilles",
  "upper_achilles",
  "achilles",
  "full_body",
] as const;

export type StrengthSessionType = (typeof STRENGTH_SESSION_TYPES)[number];
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
  /** Dumbbells the lift uses (1 or 2). Omit for bodyweight, or when a standard
   *  pair (2, one per hand) is implied for a dumbbell lift. */
  dumbbells?: 1 | 2;
  /** Short note on how the load is held, e.g. "opposite hand", "goblet". */
  holdNote?: string;
  /** Ordering role inside an Achilles block. */
  achillesRole?: AchillesRole;
  /** Primary muscle the lift trains — drives the custom-builder grouping. */
  primaryMuscle?: string;
  /** Secondary muscles for compound lifts. */
  secondaryMuscles?: string[];
  /** Required equipment; every item must be available. Empty = bodyweight. */
  equipment?: Equipment[];
}

/**
 * Trim priority for duration-fitting (see duration-fit.ts):
 *  - "primary": a main compound lift. Kept at every session length; only its
 *    set count flexes.
 *  - "accessory": isolation/finisher work. First to go when a session has to
 *    shrink, and never added back to fatten a longer session.
 * Achilles-role exercises (see ExerciseDef.achillesRole) are NEVER
 * "accessory" regardless of this field — the tendon program is load-bearing,
 * not optional, and is protected from removal in the fitting logic itself.
 */
export type SlotPriority = "primary" | "accessory";

/** A prescribed slot in a session template. */
export interface TemplateSlot {
  exerciseSlug: string;
  sets: number;
  repLow: number;
  repHigh: number;
  restSeconds: number;
  /** Loaded per hand/leg rather than a matched pair, when relevant. */
  perSide?: boolean;
  /** Trim priority; omitted = "primary" (see SlotPriority). */
  priority?: SlotPriority;
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

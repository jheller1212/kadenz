import type { ExerciseDef, SessionTemplate, StrengthSessionType } from "./types";

// ── Exercise catalogue ────────────────────────────────────────────────────────
// The single source of truth for seeding `strength_exercises` and for building
// session templates. Slugs are stable keys — do not rename once seeded.

export const EXERCISES: ExerciseDef[] = [
  // Upper day
  {
    slug: "overhead_press",
    name: "Standing overhead press",
    category: "upper",
    tempoNote: "Controlled, no leg drive",
    slowProgressor: true, // flagged: progresses slower than other lifts
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 7.5,
  },
  {
    slug: "bent_over_row",
    name: "Bent-over row",
    category: "upper",
    tempoNote: "Flat back, squeeze at top",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 12.5,
  },
  {
    slug: "floor_press",
    name: "Floor press",
    category: "upper",
    equipmentNote: "Lying on floor, elbows rest between reps",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 10,
  },
  {
    slug: "renegade_row",
    name: "Renegade row",
    category: "upper",
    equipmentNote: "Plank position on dumbbells",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 7.5,
  },
  {
    slug: "curl_to_press",
    name: "Curl to press",
    category: "upper",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 7.5,
  },

  // Lower day
  {
    slug: "db_squat",
    name: "Dumbbell squat",
    category: "lower",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 12.5,
  },
  {
    slug: "romanian_deadlift",
    name: "Romanian deadlift",
    category: "lower",
    tempoNote: "Hinge, soft knees, hamstring stretch",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 15,
  },
  {
    slug: "bulgarian_split_squat",
    name: "Bulgarian split squat (chair)",
    category: "lower",
    equipmentNote: "Rear foot on chair",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 7.5,
  },
  {
    slug: "single_leg_hip_thrust",
    name: "Single-leg hip thrust (chair)",
    category: "lower",
    equipmentNote: "Shoulders on chair; bodyweight, then 10 kg",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: undefined, // bodyweight to start
  },

  // Achilles block (explosive first, slow heavy after)
  {
    slug: "explosive_box_step_up",
    name: "Explosive box step-up",
    category: "achilles",
    equipmentNote: "Replaces Bulgarian split squat on Achilles days",
    tempoNote: "Fast up, slow down",
    achillesRole: "explosive",
    defaultSets: 3,
    repLow: 6,
    repHigh: 6,
    startWeightKg: 10, // 10–15 kg per hand
  },
  {
    slug: "loaded_toe_walk",
    name: "Loaded toe walk",
    category: "achilles",
    equipmentNote: "2 × 25 kg, 20–30 m, 3 rounds",
    achillesRole: "explosive",
    defaultSets: 3,
    repLow: 1,
    repHigh: 1, // one walk per round
    startWeightKg: 25,
  },
  {
    slug: "straight_knee_calf_raise",
    name: "Straight-knee calf raise (HSR)",
    category: "achilles",
    equipmentNote: "Flat ground only — no step",
    tempoNote: "3 s up, 3 s down",
    flatGroundOnly: true,
    achillesRole: "slow_heavy",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 15,
  },
  {
    slug: "bent_knee_calf_raise",
    name: "Bent-knee calf raise (HSR, soleus)",
    category: "achilles",
    equipmentNote: "Goblet hold, flat ground only",
    tempoNote: "3 s up, 3 s down",
    flatGroundOnly: true,
    achillesRole: "slow_heavy",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 15,
  },
];

export const EXERCISE_BY_SLUG: Record<string, ExerciseDef> = Object.fromEntries(
  EXERCISES.map((e) => [e.slug, e])
);

// ── Session templates ─────────────────────────────────────────────────────────
// Slot order IS session order. For lower_achilles, explosive Achilles work is
// placed before the slow-heavy HSR calf work (a hard rule, also validated).

export const SESSION_TEMPLATES: Record<StrengthSessionType, SessionTemplate> = {
  upper: {
    type: "upper",
    title: "Upper — Kraft",
    targetDurationMinutes: 35,
    slots: [
      { exerciseSlug: "overhead_press", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90 },
      { exerciseSlug: "bent_over_row", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90 },
      { exerciseSlug: "floor_press", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90 },
      { exerciseSlug: "renegade_row", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90 },
      { exerciseSlug: "curl_to_press", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90 },
    ],
  },
  lower: {
    type: "lower",
    title: "Lower — Kraft",
    targetDurationMinutes: 28,
    slots: [
      { exerciseSlug: "db_squat", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90 },
      { exerciseSlug: "romanian_deadlift", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90 },
      { exerciseSlug: "bulgarian_split_squat", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90, perSide: true },
      { exerciseSlug: "single_leg_hip_thrust", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90, perSide: true },
    ],
  },
  lower_achilles: {
    type: "lower_achilles",
    title: "Lower + Achilles — Kraft",
    targetDurationMinutes: 46,
    slots: [
      // Explosive first
      { exerciseSlug: "explosive_box_step_up", sets: 3, repLow: 6, repHigh: 6, restSeconds: 90, perSide: true },
      { exerciseSlug: "loaded_toe_walk", sets: 3, repLow: 1, repHigh: 1, restSeconds: 90 },
      // Main lower strength
      { exerciseSlug: "db_squat", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90 },
      { exerciseSlug: "romanian_deadlift", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90 },
      { exerciseSlug: "single_leg_hip_thrust", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90, perSide: true },
      // Slow heavy (HSR) last
      { exerciseSlug: "straight_knee_calf_raise", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90 },
      { exerciseSlug: "bent_knee_calf_raise", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90 },
    ],
  },
};

export const SESSION_TIME_TARGETS: Record<StrengthSessionType, number> = {
  upper: 35,
  lower: 28,
  lower_achilles: 46,
};

// ── HSR calf-raise week-based prescription ───────────────────────────────────
// Both HSR calf raises follow the same load/rep scheme, which ramps by program
// week. Returns the target for a given 1-based program week.

export interface HsrPrescription {
  weightKg: number;
  sets: number;
  reps: number;
  singleLeg: boolean;
  label: string;
}

export function hsrPrescriptionForWeek(programWeek: number): HsrPrescription {
  if (programWeek <= 2) {
    return { weightKg: 15, sets: 3, reps: 12, singleLeg: false, label: "Wk 1–2: 2×15 kg, 3×12" };
  }
  if (programWeek <= 4) {
    return { weightKg: 20, sets: 3, reps: 10, singleLeg: false, label: "Wk 3–4: 2×20 kg, 3×10" };
  }
  return { weightKg: 20, sets: 3, reps: 8, singleLeg: true, label: "Wk 5+: single leg 15–25 kg, 3×8" };
}

const HSR_SLUGS = new Set(["straight_knee_calf_raise", "bent_knee_calf_raise"]);

export function isHsrExercise(slug: string): boolean {
  return HSR_SLUGS.has(slug);
}

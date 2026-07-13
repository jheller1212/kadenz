import type { ExerciseDef, SessionTemplate, StrengthSessionType } from "./types";

// ── Exercise catalogue ────────────────────────────────────────────────────────
// The single source of truth for seeding `strength_exercises` and for building
// session templates. Slugs are stable keys — do not rename once seeded.

export const EXERCISES: ExerciseDef[] = [
  // Upper day
  {
    slug: "overhead_press",
    primaryMuscle: "Shoulders",
    secondaryMuscles: ["Triceps", "Core"],
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
    primaryMuscle: "Back",
    secondaryMuscles: ["Biceps", "Rear delts"],
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
    primaryMuscle: "Chest",
    secondaryMuscles: ["Triceps", "Front delts"],
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
    primaryMuscle: "Back",
    secondaryMuscles: ["Core", "Shoulders"],
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
    primaryMuscle: "Arms",
    secondaryMuscles: ["Shoulders"],
    name: "Curl to press",
    category: "upper",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 7.5,
  },
  {
    slug: "lateral_raise",
    primaryMuscle: "Shoulders",
    name: "Lateral raise",
    category: "upper",
    tempoNote: "Strict, no swing — light weight, controlled lower",
    defaultSets: 3,
    repLow: 12,
    repHigh: 15,
    startWeightKg: 5,
  },

  // Lower day
  {
    slug: "db_squat",
    primaryMuscle: "Quads",
    secondaryMuscles: ["Glutes", "Core"],
    name: "Dumbbell squat",
    category: "lower",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 12.5,
  },
  {
    slug: "romanian_deadlift",
    primaryMuscle: "Hamstrings",
    secondaryMuscles: ["Glutes", "Lower back"],
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
    primaryMuscle: "Quads",
    secondaryMuscles: ["Glutes", "Core"],
    name: "Bulgarian split squat (chair)",
    category: "lower",
    equipmentNote: "Rear foot on chair",
    tempoNote: "Slow eccentric, 3-4 seconds down",
    defaultSets: 3,
    repLow: 15,
    repHigh: 25,
    startWeightKg: 7.5,
  },
  {
    slug: "single_leg_rdl",
    primaryMuscle: "Hamstrings",
    secondaryMuscles: ["Glutes", "Core"],
    name: "Single-leg Romanian deadlift",
    category: "lower",
    tempoNote: "Slow eccentric, 3-4 seconds down, hamstring stretch",
    defaultSets: 3,
    repLow: 15,
    repHigh: 25,
    startWeightKg: 15,
  },
  {
    slug: "single_leg_hip_thrust",
    primaryMuscle: "Glutes",
    secondaryMuscles: ["Hamstrings"],
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
    primaryMuscle: "Calves & Achilles",
    secondaryMuscles: ["Quads", "Glutes"],
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
    primaryMuscle: "Calves & Achilles",
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
    primaryMuscle: "Calves & Achilles",
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
    primaryMuscle: "Calves & Achilles",
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

  // Full-body day (household program — beginner-friendly starting loads)
  {
    slug: "goblet_squat",
    primaryMuscle: "Quads",
    secondaryMuscles: ["Glutes", "Core"],
    name: "Goblet squat",
    category: "full_body",
    equipmentNote: "One dumbbell held at the chest",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 8,
  },
  {
    slug: "one_arm_row",
    primaryMuscle: "Back",
    secondaryMuscles: ["Biceps", "Core"],
    name: "One-arm dumbbell row",
    category: "full_body",
    equipmentNote: "Support yourself on a chair or bench",
    tempoNote: "Drive the elbow back, squeeze at top",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 10,
  },
  {
    slug: "glute_bridge",
    primaryMuscle: "Glutes",
    secondaryMuscles: ["Hamstrings"],
    name: "Glute bridge",
    category: "full_body",
    equipmentNote: "Dumbbell resting on the hips",
    tempoNote: "Pause and squeeze at the top",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 12.5,
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
    targetDurationMinutes: 40,
    effortNote: "1-2 reps in reserve on the last set of each exercise",
    slots: [
      { exerciseSlug: "overhead_press", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90 },
      { exerciseSlug: "bent_over_row", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90 },
      { exerciseSlug: "floor_press", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90 },
      { exerciseSlug: "renegade_row", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90 },
      { exerciseSlug: "curl_to_press", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90 },
      { exerciseSlug: "lateral_raise", sets: 3, repLow: 12, repHigh: 15, restSeconds: 60 },
    ],
  },
  lower: {
    type: "lower",
    title: "Lower — Kraft",
    targetDurationMinutes: 35,
    effortNote: "1-2 reps in reserve on the last set of each exercise",
    slots: [
      { exerciseSlug: "db_squat", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90 },
      { exerciseSlug: "romanian_deadlift", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90 },
      { exerciseSlug: "bulgarian_split_squat", sets: 3, repLow: 15, repHigh: 25, restSeconds: 90, perSide: true },
      { exerciseSlug: "single_leg_rdl", sets: 3, repLow: 15, repHigh: 25, restSeconds: 90, perSide: true },
    ],
  },
  full_body: {
    type: "full_body",
    title: "Full Body",
    targetDurationMinutes: 38,
    effortNote: "1-2 reps in reserve on the last set of each exercise",
    slots: [
      { exerciseSlug: "goblet_squat", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90 },
      { exerciseSlug: "romanian_deadlift", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90 },
      { exerciseSlug: "floor_press", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90 },
      { exerciseSlug: "one_arm_row", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90, perSide: true },
      { exerciseSlug: "overhead_press", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90 },
      { exerciseSlug: "glute_bridge", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90 },
    ],
  },
  upper_achilles: {
    type: "upper_achilles",
    title: "Upper + Achilles — Kraft",
    targetDurationMinutes: 50,
    effortNote: "1-2 reps in reserve on upper; explosive step-ups at 6 reps only",
    slots: [
      // Upper
      { exerciseSlug: "overhead_press", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90 },
      { exerciseSlug: "bent_over_row", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90 },
      { exerciseSlug: "floor_press", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90 },
      { exerciseSlug: "curl_to_press", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90 },
      // Achilles: explosive first, then HSR
      { exerciseSlug: "explosive_box_step_up", sets: 3, repLow: 6, repHigh: 6, restSeconds: 90, perSide: true },
      { exerciseSlug: "straight_knee_calf_raise", sets: 3, repLow: 8, repHigh: 12, restSeconds: 120 },
      { exerciseSlug: "bent_knee_calf_raise", sets: 3, repLow: 8, repHigh: 12, restSeconds: 120 },
    ],
  },
  achilles: {
    type: "achilles",
    title: "Achilles — Kraft",
    targetDurationMinutes: 20,
    effortNote: "Explosive at 6 reps only; HSR at 2x/week only",
    slots: [
      // Explosive first, then the 2 HSR lifts + toe walks — a focused tendon
      // session needs no general lower work (that lives in the combo days).
      { exerciseSlug: "explosive_box_step_up", sets: 3, repLow: 6, repHigh: 6, restSeconds: 90, perSide: true },
      // Slow heavy (HSR) — 2x per week
      { exerciseSlug: "straight_knee_calf_raise", sets: 3, repLow: 8, repHigh: 12, restSeconds: 120 },
      { exerciseSlug: "bent_knee_calf_raise", sets: 3, repLow: 8, repHigh: 12, restSeconds: 120 },
      { exerciseSlug: "loaded_toe_walk", sets: 3, repLow: 1, repHigh: 1, restSeconds: 120 },
    ],
  },
  lower_achilles: {
    type: "lower_achilles",
    title: "Lower + Achilles — Kraft",
    targetDurationMinutes: 50,
    effortNote: "1-2 reps in reserve on lower/upper; explosive at 6 reps only",
    slots: [
      // Explosive first
      { exerciseSlug: "explosive_box_step_up", sets: 3, repLow: 6, repHigh: 6, restSeconds: 90, perSide: true },
      // Slow heavy (HSR) second
      { exerciseSlug: "straight_knee_calf_raise", sets: 3, repLow: 8, repHigh: 12, restSeconds: 120 },
      { exerciseSlug: "bent_knee_calf_raise", sets: 3, repLow: 8, repHigh: 12, restSeconds: 120 },
      // Toe walks third
      { exerciseSlug: "loaded_toe_walk", sets: 3, repLow: 1, repHigh: 1, restSeconds: 120 },
      // Main lower strength
      { exerciseSlug: "db_squat", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90 },
      { exerciseSlug: "romanian_deadlift", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90 },
      { exerciseSlug: "bulgarian_split_squat", sets: 3, repLow: 15, repHigh: 25, restSeconds: 90, perSide: true },
      { exerciseSlug: "single_leg_rdl", sets: 3, repLow: 15, repHigh: 25, restSeconds: 90, perSide: true },
      // Glute bridge last
      { exerciseSlug: "glute_bridge", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90 },
    ],
  },
};

export const SESSION_TIME_TARGETS: Record<StrengthSessionType, number> = {
  upper: 40,
  lower: 35,
  upper_achilles: 50,
  achilles: 20,
  lower_achilles: 50,
  full_body: 38,
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

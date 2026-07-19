import type {
  Complaint,
  ExerciseDef,
  SessionTemplate,
  StrengthSessionType,
  TemplateSlot,
} from "./types";

// ── Exercise catalogue ────────────────────────────────────────────────────────
// The single source of truth for seeding `strength_exercises` and for building
// session templates. Slugs are stable keys — do not rename once seeded.

export const EXERCISES: ExerciseDef[] = [
  // Upper day
  {
    slug: "overhead_press",
    equipment: ["dumbbell"],
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
    equipment: ["dumbbell"],
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
    equipment: ["dumbbell"],
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
    equipment: ["dumbbell"],
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
    equipment: ["dumbbell"],
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
    equipment: ["dumbbell"],
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
    equipment: ["dumbbell"],
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
    equipment: ["dumbbell"],
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
    equipment: ["dumbbell", "chair"],
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
    dumbbells: 2,
    holdNote: "one per hand",
  },
  {
    slug: "single_leg_rdl",
    equipment: ["dumbbell"],
    primaryMuscle: "Hamstrings",
    secondaryMuscles: ["Glutes", "Core"],
    name: "Single-leg Romanian deadlift",
    category: "lower",
    tempoNote: "Slow eccentric, 3-4 seconds down, hamstring stretch",
    defaultSets: 3,
    repLow: 15,
    repHigh: 25,
    startWeightKg: 15,
    dumbbells: 1,
    holdNote: "opposite hand",
  },
  {
    slug: "single_leg_hip_thrust",
    equipment: ["chair"],
    primaryMuscle: "Glutes",
    secondaryMuscles: ["Hamstrings"],
    name: "Single-leg hip thrust (chair)",
    category: "lower",
    equipmentNote: "Shoulders on chair; bodyweight, then 10 kg",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: undefined, // bodyweight to start
    dumbbells: 1,
    holdNote: "on hips",
  },

  // Achilles block (explosive first, slow heavy after)
  {
    slug: "explosive_box_step_up",
    equipment: ["box"],
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
    equipment: ["dumbbell"],
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
    equipment: ["dumbbell"],
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
    equipment: ["dumbbell"],
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
    dumbbells: 1,
    holdNote: "goblet",
  },

  // Full-body day (household program — beginner-friendly starting loads)
  {
    slug: "goblet_squat",
    equipment: ["dumbbell"],
    primaryMuscle: "Quads",
    secondaryMuscles: ["Glutes", "Core"],
    name: "Goblet squat",
    category: "full_body",
    equipmentNote: "One dumbbell held at the chest",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 8,
    dumbbells: 1,
    holdNote: "at chest",
  },
  {
    slug: "one_arm_row",
    equipment: ["dumbbell", "chair"],
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
    dumbbells: 1,
    holdNote: "working arm",
  },
  {
    slug: "glute_bridge",
    equipment: ["dumbbell"],
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
    dumbbells: 1,
    holdNote: "on hips",
  },
  // General runner calf work — ordinary strength, not the achilles rehab
  // protocol. Belongs in the default lower/full_body rotation for everyone,
  // achilles-goal or not (achilles-goal athletes already get HSR calf work
  // in their combo/achilles sessions, so this only appears on plain
  // lower/full_body days).
  {
    slug: "standing_calf_raise",
    equipment: ["dumbbell"],
    primaryMuscle: "Calves",
    name: "Standing calf raise",
    category: "lower",
    tempoNote: "Full range, controlled — no bouncing",
    defaultSets: 3,
    repLow: 12,
    repHigh: 15,
    startWeightKg: 10,
    dumbbells: 1,
    holdNote: "both hands",
  },

  // ── Complaint-targeted work (see TARGETED_WORK below) — small, well-
  // evidenced additions for a reported non-Achilles complaint. Not part of
  // the default rotation; injected only when the matching complaint is set.
  {
    slug: "single_leg_calf_raise",
    equipment: [],
    primaryMuscle: "Calves",
    secondaryMuscles: ["Feet"],
    name: "Single-leg calf raise",
    category: "lower",
    equipmentNote: "Bodyweight; hold a wall for balance if needed",
    tempoNote: "Slow up and down, full range",
    defaultSets: 3,
    repLow: 10,
    repHigh: 15,
  },
  {
    slug: "tibialis_raise",
    equipment: [],
    primaryMuscle: "Shin (tibialis anterior)",
    name: "Tibialis raise",
    category: "lower",
    equipmentNote: "Heels on a step or thick book, toes hanging off the edge",
    tempoNote: "Slow controlled raise, pause at the top",
    defaultSets: 3,
    repLow: 15,
    repHigh: 20,
  },
  {
    slug: "step_down",
    equipment: ["box"],
    primaryMuscle: "Quads",
    secondaryMuscles: ["Glutes"],
    name: "Step-down (eccentric)",
    category: "lower",
    equipmentNote: "Low step or box; standing on one leg, lower slowly, tap the heel down",
    tempoNote: "3–4 s down, keep the knee tracking over the toes",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
  },
  {
    slug: "side_lying_leg_raise",
    equipment: [],
    primaryMuscle: "Glutes",
    secondaryMuscles: ["Hip abductors"],
    name: "Side-lying leg raise",
    category: "lower",
    equipmentNote: "Lying on your side, legs stacked and straight",
    tempoNote: "Lift to hip height, slow controlled lower",
    defaultSets: 3,
    repLow: 12,
    repHigh: 20,
  },
  {
    slug: "clamshell",
    equipment: [],
    primaryMuscle: "Glutes",
    secondaryMuscles: ["Hip external rotators"],
    name: "Clamshell",
    category: "lower",
    equipmentNote: "Lying on your side, knees bent, feet together",
    tempoNote: "Open the top knee against resistance, slow controlled close",
    defaultSets: 3,
    repLow: 15,
    repHigh: 20,
  },
  {
    slug: "nordic_curl_negative",
    equipment: ["chair"],
    primaryMuscle: "Hamstrings",
    name: "Nordic curl negative",
    category: "lower",
    equipmentNote: "Kneeling, ankles anchored under a chair or couch",
    tempoNote: "Lower yourself forward as slowly as you can control, catch with your hands",
    defaultSets: 3,
    repLow: 5,
    repHigh: 8,
  },

  // ── Extended library (custom-workout builder; home setup: dumbbells + chair
  // + floor, no bench). Not part of any stock session template.
  {
    slug: "db_floor_fly",
    equipment: ["dumbbell"],
    primaryMuscle: "Chest",
    secondaryMuscles: ["Front delts"],
    name: "Floor chest fly",
    category: "upper",
    equipmentNote: "Lying on the floor, slight elbow bend",
    tempoNote: "Slow arc, stop when upper arms touch the floor",
    defaultSets: 3,
    repLow: 10,
    repHigh: 15,
    startWeightKg: 7.5,
  },
  {
    slug: "push_up",
    equipment: [],
    primaryMuscle: "Chest",
    secondaryMuscles: ["Triceps", "Core"],
    name: "Push-up",
    category: "upper",
    tempoNote: "Body in one line, chest to just above the floor",
    defaultSets: 3,
    repLow: 8,
    repHigh: 20,
  },
  {
    slug: "bicep_curl",
    equipment: ["dumbbell"],
    primaryMuscle: "Arms",
    name: "Biceps curl",
    category: "upper",
    tempoNote: "No swing — elbows pinned to your sides",
    defaultSets: 3,
    repLow: 10,
    repHigh: 15,
    startWeightKg: 10,
  },
  {
    slug: "hammer_curl",
    equipment: ["dumbbell"],
    primaryMuscle: "Arms",
    secondaryMuscles: ["Forearms"],
    name: "Hammer curl",
    category: "upper",
    tempoNote: "Neutral grip, controlled lower",
    defaultSets: 3,
    repLow: 10,
    repHigh: 15,
    startWeightKg: 10,
  },
  {
    slug: "overhead_triceps_extension",
    equipment: ["dumbbell"],
    primaryMuscle: "Arms",
    name: "Overhead triceps extension",
    category: "upper",
    equipmentNote: "Both hands on one dumbbell behind the head",
    tempoNote: "Elbows stay narrow and pointed forward",
    defaultSets: 3,
    repLow: 10,
    repHigh: 15,
    startWeightKg: 10,
    dumbbells: 1,
    holdNote: "both hands",
  },
  {
    slug: "triceps_kickback",
    equipment: ["dumbbell"],
    primaryMuscle: "Arms",
    name: "Triceps kickback",
    category: "upper",
    equipmentNote: "Hinge forward, support on a chair if needed",
    tempoNote: "Upper arm parallel to the floor, squeeze at lockout",
    defaultSets: 3,
    repLow: 10,
    repHigh: 15,
    startWeightKg: 5,
  },
  {
    slug: "front_raise",
    equipment: ["dumbbell"],
    primaryMuscle: "Shoulders",
    name: "Front raise",
    category: "upper",
    tempoNote: "To eye height, no momentum",
    defaultSets: 3,
    repLow: 10,
    repHigh: 15,
    startWeightKg: 5,
  },
  {
    slug: "rear_delt_fly",
    equipment: ["dumbbell"],
    primaryMuscle: "Shoulders",
    secondaryMuscles: ["Upper back"],
    name: "Rear-delt fly",
    category: "upper",
    equipmentNote: "Hinge forward, flat back",
    tempoNote: "Lead with the elbows, pause at the top",
    defaultSets: 3,
    repLow: 12,
    repHigh: 15,
    startWeightKg: 5,
  },
  {
    slug: "arnold_press",
    equipment: ["dumbbell"],
    primaryMuscle: "Shoulders",
    secondaryMuscles: ["Triceps"],
    name: "Arnold press",
    category: "upper",
    tempoNote: "Rotate palms out on the way up, controlled return",
    slowProgressor: true,
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 7.5,
  },
  {
    slug: "db_pullover",
    equipment: ["dumbbell"],
    primaryMuscle: "Back",
    secondaryMuscles: ["Chest", "Core"],
    name: "Dumbbell pullover",
    category: "upper",
    equipmentNote: "Lying on the floor, both hands on one dumbbell",
    tempoNote: "Slow arc overhead, ribs down",
    defaultSets: 3,
    repLow: 10,
    repHigh: 15,
    startWeightKg: 10,
  },
  {
    slug: "db_shrug",
    equipment: ["dumbbell"],
    primaryMuscle: "Back",
    name: "Dumbbell shrug",
    category: "upper",
    tempoNote: "Straight up, 1 s hold at the top",
    defaultSets: 3,
    repLow: 12,
    repHigh: 15,
    startWeightKg: 15,
  },
  {
    slug: "reverse_lunge",
    equipment: ["dumbbell"],
    primaryMuscle: "Quads",
    secondaryMuscles: ["Glutes", "Core"],
    name: "Reverse lunge",
    category: "lower",
    tempoNote: "Step back, knee hovers just off the floor",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 10,
  },
  {
    slug: "sumo_squat",
    equipment: ["dumbbell"],
    primaryMuscle: "Glutes",
    secondaryMuscles: ["Quads", "Inner thighs"],
    name: "Sumo squat",
    category: "lower",
    equipmentNote: "Wide stance, one dumbbell held at the chest or hanging",
    tempoNote: "Knees track over toes, tall chest",
    defaultSets: 3,
    repLow: 10,
    repHigh: 15,
    startWeightKg: 12.5,
  },
  {
    slug: "russian_twist",
    equipment: ["dumbbell"],
    primaryMuscle: "Core",
    name: "Russian twist",
    category: "full_body",
    equipmentNote: "Seated, heels light or lifted, dumbbell at the chest",
    tempoNote: "Rotate from the trunk, not the arms",
    defaultSets: 3,
    repLow: 10,
    repHigh: 20,
    startWeightKg: 5,
  },
  {
    slug: "weighted_situp",
    equipment: ["dumbbell"],
    primaryMuscle: "Core",
    name: "Weighted sit-up",
    category: "full_body",
    equipmentNote: "Dumbbell hugged to the chest",
    tempoNote: "Slow down phase — 2-3 seconds",
    defaultSets: 3,
    repLow: 10,
    repHigh: 15,
    startWeightKg: 5,
  },
];

export const EXERCISE_BY_SLUG: Record<string, ExerciseDef> = Object.fromEntries(
  EXERCISES.map((e) => [e.slug, e])
);

// ── Session templates ─────────────────────────────────────────────────────────
// Slot order IS session order. For lower_achilles, explosive Achilles work is
// placed before the slow-heavy HSR calf work (a hard rule, also validated).
//
// `priority: "accessory"` marks isolation/finisher work — the first thing
// duration-fit.ts drops when a session has to shrink to fit a shorter chosen
// length, and the last thing it adds sets to when a session has room to grow.
// Everything else defaults to "primary" (main compound lifts). Achilles-role
// exercises (see program.ts EXERCISES `achillesRole`) are hard-protected in
// duration-fit.ts regardless of this field — the tendon program isn't optional.

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
      { exerciseSlug: "curl_to_press", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90, priority: "accessory" },
      { exerciseSlug: "lateral_raise", sets: 3, repLow: 12, repHigh: 15, restSeconds: 60, priority: "accessory" },
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
      { exerciseSlug: "bulgarian_split_squat", sets: 3, repLow: 15, repHigh: 25, restSeconds: 90, perSide: true, priority: "accessory" },
      { exerciseSlug: "single_leg_rdl", sets: 3, repLow: 15, repHigh: 25, restSeconds: 90, perSide: true, priority: "accessory" },
      // Ordinary runner calf work — not the Achilles HSR protocol.
      { exerciseSlug: "standing_calf_raise", sets: 3, repLow: 12, repHigh: 15, restSeconds: 60, priority: "accessory" },
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
      { exerciseSlug: "overhead_press", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90, priority: "accessory" },
      { exerciseSlug: "glute_bridge", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90, priority: "accessory" },
      // Ordinary runner calf work — not the Achilles HSR protocol.
      { exerciseSlug: "standing_calf_raise", sets: 3, repLow: 12, repHigh: 15, restSeconds: 60, priority: "accessory" },
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
      { exerciseSlug: "curl_to_press", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90, priority: "accessory" },
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
      { exerciseSlug: "bulgarian_split_squat", sets: 3, repLow: 15, repHigh: 25, restSeconds: 90, perSide: true, priority: "accessory" },
      { exerciseSlug: "single_leg_rdl", sets: 3, repLow: 15, repHigh: 25, restSeconds: 90, perSide: true, priority: "accessory" },
      // Glute bridge last
      { exerciseSlug: "glute_bridge", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90, priority: "accessory" },
    ],
  },
};

// ── Complaint-targeted work ───────────────────────────────────────────────────
// Maps a reported non-Achilles complaint to one small, well-evidenced slot,
// injected into the ordinary lower/full_body sessions when that complaint is
// present. "achilles" is handled separately (the existing dedicated
// achilles/lower_achilles/upper_achilles session types + HSR protocol) and is
// intentionally absent from this map.
export const TARGETED_WORK: Partial<
  Record<Complaint, { slug: string; slot: Omit<TemplateSlot, "exerciseSlug">; sessionTypes: StrengthSessionType[] }>
> = {
  plantar_fascia: {
    slug: "single_leg_calf_raise",
    slot: { sets: 3, repLow: 10, repHigh: 15, restSeconds: 60, perSide: true, priority: "targeted" },
    sessionTypes: ["lower", "full_body"],
  },
  shin: {
    slug: "tibialis_raise",
    slot: { sets: 3, repLow: 15, repHigh: 20, restSeconds: 45, priority: "targeted" },
    sessionTypes: ["lower", "full_body"],
  },
  knee: {
    slug: "step_down",
    slot: { sets: 3, repLow: 8, repHigh: 12, restSeconds: 90, perSide: true, priority: "targeted" },
    sessionTypes: ["lower", "full_body"],
  },
  itb: {
    slug: "side_lying_leg_raise",
    slot: { sets: 3, repLow: 12, repHigh: 20, restSeconds: 60, perSide: true, priority: "targeted" },
    sessionTypes: ["lower", "full_body"],
  },
  hamstring: {
    slug: "nordic_curl_negative",
    slot: { sets: 3, repLow: 5, repHigh: 8, restSeconds: 120, priority: "targeted" },
    sessionTypes: ["lower", "full_body"],
  },
  hip_glute: {
    slug: "clamshell",
    slot: { sets: 3, repLow: 15, repHigh: 20, restSeconds: 45, perSide: true, priority: "targeted" },
    sessionTypes: ["lower", "full_body"],
  },
};

const ACHILLES_SESSION_TYPES = new Set<StrengthSessionType>([
  "achilles",
  "lower_achilles",
  "upper_achilles",
]);

/**
 * The session template an athlete actually gets for `type`, given their
 * reported complaints. Achilles session types are always returned unchanged
 * — that programme already exists and is complaint-independent once an
 * athlete is on it. For every other session type, each non-Achilles
 * complaint whose `TARGETED_WORK` entry lists `type` gets its slot appended.
 */
export function sessionTemplateFor(
  type: StrengthSessionType,
  complaints: Complaint[] = []
): SessionTemplate {
  const template = SESSION_TEMPLATES[type];
  if (ACHILLES_SESSION_TYPES.has(type)) return template;

  const extraSlots: TemplateSlot[] = [];
  const seen = new Set<string>();
  for (const complaint of complaints) {
    if (complaint === "achilles") continue;
    const targeted = TARGETED_WORK[complaint];
    if (!targeted || !targeted.sessionTypes.includes(type)) continue;
    if (seen.has(targeted.slug)) continue; // don't double-add a shared exercise
    seen.add(targeted.slug);
    extraSlots.push({ exerciseSlug: targeted.slug, ...targeted.slot });
  }
  if (extraSlots.length === 0) return template;

  return { ...template, slots: [...template.slots, ...extraSlots] };
}

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

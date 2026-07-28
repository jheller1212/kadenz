import type {
  Complaint,
  Equipment,
  ExerciseDef,
  SessionTemplate,
  SlotVariant,
  StrengthCategory,
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
    // Genuinely a two-muscle move: the curl trains biceps, the press extends
    // through triceps and shoulders. Anchored on Biceps (the named-first
    // half of the movement) with Triceps carried as a secondary so it still
    // surfaces under a Triceps filter, just ranked behind pure triceps work.
    primaryMuscle: "Biceps",
    secondaryMuscles: ["Triceps", "Shoulders"],
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
    tempoNote: "Strict, no swing, light weight, controlled lower",
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
    equipmentNote: "Flat ground only, no step",
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
    tempoNote: "Full range, controlled, no bouncing",
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
  // Bodyweight fallbacks for the two complaint-targeted exercises above that
  // hard-require a chair/box — without these, an athlete with neither gets
  // nothing prescribed for a reported knee or hamstring complaint, even
  // though targeted work is supposed to be protected like Achilles work
  // (see resolveSlotVariant / KNEE_TARGETED_VARIANTS / HAMSTRING_TARGETED_
  // VARIANTS below). Deliberately distinct movements from the generic
  // squat/hinge bodyweight floors (air_squat, hip_raise) so this fallback
  // never collides with — and gets deduped away by — an ordinary lower/
  // full_body slot in the same bodyweight-only session.
  {
    slug: "wall_sit",
    equipment: [],
    primaryMuscle: "Quads",
    secondaryMuscles: ["Knee stability"],
    name: "Wall sit",
    category: "lower",
    equipmentNote:
      "Back flat against a wall, thighs parallel to the floor, no step or chair needed. Reps shown are seconds held, not a rep count.",
    tempoNote: "Static hold, knees tracking over the toes",
    defaultSets: 3,
    repLow: 30,
    repHigh: 45,
  },
  {
    slug: "single_leg_glute_bridge",
    equipment: [],
    primaryMuscle: "Hamstrings",
    secondaryMuscles: ["Glutes"],
    name: "Single-leg glute bridge",
    category: "lower",
    equipmentNote: "One foot planted, other leg extended straight, no chair anchor needed",
    tempoNote: "Pause and squeeze at the top, slow controlled lower",
    defaultSets: 3,
    repLow: 10,
    repHigh: 15,
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
    primaryMuscle: "Biceps",
    name: "Biceps curl",
    category: "upper",
    tempoNote: "No swing, elbows pinned to your sides",
    defaultSets: 3,
    repLow: 10,
    repHigh: 15,
    startWeightKg: 10,
  },
  {
    slug: "hammer_curl",
    equipment: ["dumbbell"],
    primaryMuscle: "Biceps",
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
    primaryMuscle: "Triceps",
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
    primaryMuscle: "Triceps",
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
    tempoNote: "Slow down phase, 2-3 seconds",
    defaultSets: 3,
    repLow: 10,
    repHigh: 15,
    startWeightKg: 5,
  },

  // ── Barbell / bench / pull-up bar / kettlebell / band library ────────────
  // Added so the equipment picker actually changes what a runner gets (see
  // sessionTemplateFor / resolveSlotVariant below) — every entry here is a
  // ranked upgrade or floor for an existing movement pattern (squat, hinge,
  // press, pull/row, hip thrust), not isolation filler. Slugs follow the
  // Garmin exercise vocabulary (garmin-worker/data/garmin_exercises_snapshot
  // .json) wherever a match exists, so sessions pushed to the watch land on
  // a real Garmin exercise.
  {
    slug: "barbell_back_squat",
    equipment: ["barbell"],
    primaryMuscle: "Quads",
    secondaryMuscles: ["Glutes", "Core"],
    name: "Barbell back squat",
    category: "lower",
    equipmentNote: "Bar on the upper back, feet shoulder-width",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 20, // whole bar — an empty 20 kg Olympic bar is a real load to start
  },
  {
    slug: "barbell_straight_leg_deadlift",
    equipment: ["barbell"],
    primaryMuscle: "Hamstrings",
    secondaryMuscles: ["Glutes", "Lower back"],
    name: "Barbell straight-leg deadlift",
    category: "lower",
    tempoNote: "Hinge from the hips, soft knees, bar stays close to the shins",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 20, // whole bar
  },
  {
    slug: "barbell_hip_thrust_with_bench",
    equipment: ["barbell", "bench"],
    primaryMuscle: "Glutes",
    secondaryMuscles: ["Hamstrings"],
    name: "Barbell hip thrust (bench)",
    category: "lower",
    equipmentNote: "Upper back on the bench, bar padded across the hips",
    tempoNote: "Pause and squeeze at the top",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 20, // whole bar — glutes tolerate load well, still start at the empty bar
  },
  {
    slug: "barbell_bulgarian_split_squat",
    equipment: ["barbell", "bench"],
    primaryMuscle: "Quads",
    secondaryMuscles: ["Glutes", "Core"],
    name: "Barbell Bulgarian split squat",
    category: "lower",
    equipmentNote: "Rear foot on the bench, bar on the upper back",
    tempoNote: "Slow eccentric, 3-4 seconds down",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 20, // whole bar — unilateral, so this already feels heavier than it reads
  },
  {
    slug: "barbell_reverse_lunge",
    equipment: ["barbell"],
    primaryMuscle: "Quads",
    secondaryMuscles: ["Glutes", "Core"],
    name: "Barbell reverse lunge",
    category: "lower",
    tempoNote: "Step back, knee hovers just off the floor",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 20, // whole bar
  },
  {
    slug: "barbell_bench_press",
    equipment: ["barbell", "bench"],
    primaryMuscle: "Chest",
    secondaryMuscles: ["Triceps", "Front delts"],
    name: "Barbell bench press",
    category: "upper",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 20, // whole bar — standard beginner floor
  },
  {
    slug: "barbell_floor_press",
    equipment: ["barbell"],
    primaryMuscle: "Chest",
    secondaryMuscles: ["Triceps", "Front delts"],
    name: "Barbell floor press",
    category: "upper",
    equipmentNote: "Lying on the floor, elbows rest between reps, bench-free pressing",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 20, // whole bar
  },
  {
    slug: "barbell_row",
    equipment: ["barbell"],
    primaryMuscle: "Back",
    secondaryMuscles: ["Biceps", "Rear delts"],
    name: "Barbell bent-over row",
    category: "upper",
    tempoNote: "Flat back, squeeze at the top",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 20, // whole bar
  },
  {
    slug: "barbell_shoulder_press",
    equipment: ["barbell"],
    primaryMuscle: "Shoulders",
    secondaryMuscles: ["Triceps", "Core"],
    name: "Barbell shoulder press",
    category: "upper",
    tempoNote: "Controlled, no leg drive",
    slowProgressor: true, // overhead pressing progresses slower than everything else
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 20, // whole bar
  },
  {
    slug: "dumbbell_bench_press",
    equipment: ["dumbbell", "bench"],
    primaryMuscle: "Chest",
    secondaryMuscles: ["Triceps", "Front delts"],
    name: "Dumbbell bench press",
    category: "upper",
    equipmentNote: "Full range of motion off the bench, upgrade from the floor press",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 10,
  },
  {
    slug: "pull_up",
    equipment: ["pullup_bar"],
    primaryMuscle: "Back",
    secondaryMuscles: ["Biceps", "Core"],
    name: "Pull-up",
    category: "upper",
    tempoNote: "Full hang to chin over the bar, controlled lower",
    slowProgressor: true, // bodyweight vertical pulling is a slow build for most runners
    defaultSets: 3,
    repLow: 4,
    repHigh: 10,
  },
  {
    slug: "chin_up",
    equipment: ["pullup_bar"],
    primaryMuscle: "Back",
    secondaryMuscles: ["Biceps"],
    name: "Chin-up",
    category: "upper",
    equipmentNote: "Underhand grip, usually the easier of the two to build toward",
    slowProgressor: true,
    defaultSets: 3,
    repLow: 4,
    repHigh: 10,
  },
  {
    slug: "band_assisted_pull_up",
    equipment: ["pullup_bar", "band"],
    primaryMuscle: "Back",
    secondaryMuscles: ["Biceps", "Core"],
    name: "Band-assisted pull-up",
    category: "upper",
    equipmentNote: "Band looped over the bar, foot or knee in the loop for assistance",
    tempoNote: "Full hang to chin over the bar, controlled lower",
    defaultSets: 3,
    repLow: 6,
    repHigh: 10,
  },
  {
    slug: "kettlebell_swing",
    equipment: ["kettlebell"],
    primaryMuscle: "Glutes",
    secondaryMuscles: ["Hamstrings", "Core"],
    name: "Kettlebell swing",
    category: "full_body",
    equipmentNote: "One kettlebell, both hands",
    tempoNote: "Explosive hip drive, the arms just carry the bell, they don't lift it",
    defaultSets: 3,
    repLow: 10,
    repHigh: 15,
    startWeightKg: 12,
  },
  {
    slug: "kettlebell_squat",
    equipment: ["kettlebell"],
    primaryMuscle: "Quads",
    secondaryMuscles: ["Glutes", "Core"],
    name: "Kettlebell goblet squat",
    category: "lower",
    equipmentNote: "One kettlebell held at the chest",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 12,
    holdNote: "at chest",
  },
  {
    slug: "kettlebell_row",
    equipment: ["kettlebell"],
    primaryMuscle: "Back",
    secondaryMuscles: ["Biceps", "Core"],
    name: "Kettlebell row",
    category: "upper",
    equipmentNote: "Hinge forward, one kettlebell, opposite hand supported",
    tempoNote: "Drive the elbow back, squeeze at the top",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 12,
    holdNote: "working arm",
  },
  {
    slug: "kettlebell_deadlift",
    equipment: ["kettlebell"],
    primaryMuscle: "Hamstrings",
    secondaryMuscles: ["Glutes", "Lower back"],
    name: "Kettlebell deadlift",
    category: "lower",
    equipmentNote: "One kettlebell between the feet",
    tempoNote: "Hinge from the hips, soft knees",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 16,
  },
  {
    slug: "farmers_carry",
    equipment: ["kettlebell"],
    primaryMuscle: "Core",
    secondaryMuscles: ["Grip", "Traps"],
    name: "Farmers carry",
    category: "full_body",
    equipmentNote: "One kettlebell per hand, walk tall for 20-30 m",
    tempoNote: "No leaning, brace and walk",
    defaultSets: 3,
    repLow: 1,
    repHigh: 1, // one carry per round
    startWeightKg: 16,
  },
  {
    slug: "band_pull_apart",
    equipment: ["band"],
    primaryMuscle: "Shoulders",
    secondaryMuscles: ["Upper back"],
    name: "Band pull-apart",
    category: "upper",
    equipmentNote: "Arms straight out in front, pull the band apart to the chest",
    tempoNote: "Slow and controlled, this is shoulder health work, not a rep-max",
    defaultSets: 3,
    repLow: 15,
    repHigh: 20,
  },
  {
    slug: "band_row",
    equipment: ["band"],
    primaryMuscle: "Back",
    secondaryMuscles: ["Biceps", "Rear delts"],
    name: "Band row",
    category: "upper",
    equipmentNote: "Band anchored at chest height, or looped around the feet seated",
    tempoNote: "Drive the elbows back, squeeze at the top",
    defaultSets: 3,
    repLow: 12,
    repHigh: 20,
  },
  {
    slug: "band_glute_bridge",
    equipment: ["band"],
    primaryMuscle: "Glutes",
    secondaryMuscles: ["Hamstrings"],
    name: "Band glute bridge",
    category: "lower",
    equipmentNote: "Band above the knees for extra hip drive",
    tempoNote: "Pause and squeeze at the top",
    defaultSets: 3,
    repLow: 12,
    repHigh: 20,
  },
  {
    slug: "band_lateral_walk",
    equipment: ["band"],
    primaryMuscle: "Glutes",
    secondaryMuscles: ["Hip abductors"],
    name: "Band lateral walk",
    category: "lower",
    equipmentNote: "Band above the knees or ankles, stay in a quarter squat",
    tempoNote: "Small controlled steps, keep tension on the band throughout",
    defaultSets: 3,
    repLow: 12,
    repHigh: 20,
  },
  {
    slug: "band_external_rotation",
    equipment: ["band"],
    primaryMuscle: "Shoulders",
    name: "Band external rotation",
    category: "upper",
    equipmentNote: "Elbow pinned to your side, band anchored at elbow height",
    tempoNote: "Slow, controlled, rotator-cuff health work for pressing/pulling balance",
    defaultSets: 3,
    repLow: 15,
    repHigh: 20,
  },
  {
    slug: "band_deadlift",
    equipment: ["band"],
    primaryMuscle: "Hamstrings",
    secondaryMuscles: ["Glutes", "Lower back"],
    name: "Band deadlift",
    category: "lower",
    equipmentNote: "Stand on the band, hinge and pull to hip height",
    tempoNote: "Hinge from the hips, soft knees",
    defaultSets: 3,
    repLow: 12,
    repHigh: 20,
  },
  {
    slug: "band_clamshell",
    equipment: ["band"],
    primaryMuscle: "Glutes",
    secondaryMuscles: ["Hip external rotators"],
    name: "Band clamshell",
    category: "lower",
    equipmentNote: "Band above the knees, lying on your side",
    tempoNote: "Open the top knee against the band, slow controlled close",
    defaultSets: 3,
    repLow: 15,
    repHigh: 20,
  },
  {
    slug: "band_squat",
    equipment: ["band"],
    primaryMuscle: "Quads",
    secondaryMuscles: ["Glutes", "Core"],
    name: "Band squat",
    category: "lower",
    equipmentNote: "Stand on the band, handles racked at the shoulders",
    defaultSets: 3,
    repLow: 12,
    repHigh: 20,
  },
  {
    slug: "band_squat_to_press",
    equipment: ["band"],
    primaryMuscle: "Quads",
    secondaryMuscles: ["Shoulders", "Core"],
    name: "Band squat to press",
    category: "full_body",
    equipmentNote: "Stand on the band, press overhead as you stand out of the squat",
    tempoNote: "One smooth movement, not two separate ones",
    defaultSets: 3,
    repLow: 12,
    repHigh: 20,
  },
  {
    slug: "air_squat",
    equipment: [],
    primaryMuscle: "Quads",
    secondaryMuscles: ["Glutes", "Core"],
    name: "Bodyweight squat",
    category: "lower",
    equipmentNote: "No load, the squat pattern's bodyweight floor",
    defaultSets: 3,
    repLow: 15,
    repHigh: 25,
  },
  {
    slug: "hip_raise",
    equipment: [],
    primaryMuscle: "Glutes",
    secondaryMuscles: ["Hamstrings"],
    name: "Bodyweight hip raise",
    category: "lower",
    equipmentNote: "Shoulders on the floor, the hip-hinge/hip-thrust pattern's bodyweight floor",
    tempoNote: "Pause and squeeze at the top",
    defaultSets: 3,
    repLow: 15,
    repHigh: 25,
  },
  {
    slug: "superman_from_floor",
    equipment: [],
    primaryMuscle: "Lower back",
    secondaryMuscles: ["Glutes", "Shoulders"],
    name: "Superman from floor",
    category: "full_body",
    equipmentNote: "Lying face down, the pulling pattern's bodyweight floor when nothing's available to row against",
    tempoNote: "Lift chest and legs together, pause, slow controlled lower",
    defaultSets: 3,
    repLow: 10,
    repHigh: 15,
  },
  {
    slug: "pike_push_up",
    equipment: [],
    primaryMuscle: "Shoulders",
    secondaryMuscles: ["Triceps", "Core"],
    name: "Pike push-up",
    category: "upper",
    equipmentNote: "Hips high, hands and feet on the floor, the overhead-press pattern's bodyweight floor",
    tempoNote: "Head toward the floor between the hands, press back up",
    defaultSets: 3,
    repLow: 6,
    repHigh: 12,
  },

  // ── Machine / cable library (full-gym access) ────────────────────────────
  // A "full gym" access preset only means something different from a box if
  // machines actually unlock exercises a box doesn't have (see equipment.ts
  // ACCESS_PRESETS). Machines are best for isolation/accessory volume and
  // safe near-failure work without a spotter — they never replace a free
  // compound lift here (squat/hinge/press/row variant chains are untouched),
  // they upgrade the accessory slots that already exist (see the SlotVariant
  // lists below) and extend the Exchange/custom-builder library. Assisted
  // pull-up is deliberately left without a startWeightKg: more assistance
  // weight means an EASIER rep (the opposite of every other tracked load),
  // so it isn't a fit for the load-model's heavier-is-harder progression.
  {
    slug: "leg_press_machine",
    equipment: ["machine"],
    primaryMuscle: "Quads",
    secondaryMuscles: ["Glutes"],
    name: "Leg press",
    category: "lower",
    equipmentNote: "Seated, feet shoulder-width on the platform",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 20,
  },
  {
    slug: "leg_curl_machine",
    equipment: ["machine"],
    primaryMuscle: "Hamstrings",
    name: "Leg curl machine",
    category: "lower",
    equipmentNote: "Seated or lying, pad rests just above the heels",
    defaultSets: 3,
    repLow: 10,
    repHigh: 15,
    startWeightKg: 15,
  },
  {
    slug: "leg_extension_machine",
    equipment: ["machine"],
    primaryMuscle: "Quads",
    name: "Leg extension machine",
    category: "lower",
    equipmentNote: "Pad rests just above the ankles, back flat against the seat",
    defaultSets: 3,
    repLow: 12,
    repHigh: 20,
    startWeightKg: 15,
  },
  {
    slug: "hip_abduction_machine",
    equipment: ["machine"],
    primaryMuscle: "Glutes",
    secondaryMuscles: ["Hip abductors"],
    name: "Hip abduction machine",
    category: "lower",
    equipmentNote: "Seated, pads press outward against the outside of the knees",
    defaultSets: 3,
    repLow: 12,
    repHigh: 20,
    startWeightKg: 10,
  },
  {
    slug: "hip_adduction_machine",
    equipment: ["machine"],
    primaryMuscle: "Adductors",
    name: "Hip adduction machine",
    category: "lower",
    equipmentNote: "Seated, pads press inward against the inside of the knees",
    defaultSets: 3,
    repLow: 12,
    repHigh: 20,
    startWeightKg: 10,
  },
  {
    slug: "calf_raise_machine",
    equipment: ["machine"],
    primaryMuscle: "Calves",
    name: "Calf raise machine",
    category: "lower",
    equipmentNote: "Standing or seated calf raise machine, full range, controlled",
    tempoNote: "Full range, controlled, no bouncing",
    defaultSets: 3,
    repLow: 12,
    repHigh: 15,
    startWeightKg: 15,
  },
  {
    slug: "lat_pulldown_machine",
    equipment: ["machine"],
    primaryMuscle: "Back",
    secondaryMuscles: ["Biceps"],
    name: "Lat pulldown",
    category: "upper",
    equipmentNote: "Wide overhand grip, bar to the upper chest",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 15,
  },
  {
    slug: "seated_row_machine",
    equipment: ["machine"],
    primaryMuscle: "Back",
    secondaryMuscles: ["Biceps", "Rear delts"],
    name: "Seated row machine",
    category: "upper",
    equipmentNote: "Chest against the pad, drive the elbows back",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 15,
  },
  {
    slug: "cable_row",
    equipment: ["machine"],
    primaryMuscle: "Back",
    secondaryMuscles: ["Biceps", "Rear delts"],
    name: "Seated cable row",
    category: "upper",
    equipmentNote: "V-bar or dual handle, sit tall, squeeze the shoulder blades together",
    defaultSets: 3,
    repLow: 10,
    repHigh: 15,
    startWeightKg: 12.5,
  },
  {
    slug: "chest_press_machine",
    equipment: ["machine"],
    primaryMuscle: "Chest",
    secondaryMuscles: ["Triceps", "Front delts"],
    name: "Chest press machine",
    category: "upper",
    equipmentNote: "Seated, handles at chest height, press forward",
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 15,
  },
  {
    slug: "shoulder_press_machine",
    equipment: ["machine"],
    primaryMuscle: "Shoulders",
    secondaryMuscles: ["Triceps"],
    name: "Shoulder press machine",
    category: "upper",
    equipmentNote: "Seated, handles at shoulder height, press overhead",
    slowProgressor: true, // overhead pressing progresses slower than everything else
    defaultSets: 3,
    repLow: 8,
    repHigh: 12,
    startWeightKg: 12.5,
  },
  {
    slug: "cable_fly",
    equipment: ["machine"],
    primaryMuscle: "Chest",
    secondaryMuscles: ["Front delts"],
    name: "Cable fly",
    category: "upper",
    equipmentNote: "Standing between two cable stacks, slight elbow bend, arc the hands together",
    tempoNote: "Slow arc, stop at chest height",
    defaultSets: 3,
    repLow: 10,
    repHigh: 15,
    startWeightKg: 7.5,
  },
  {
    slug: "triceps_pushdown",
    equipment: ["machine"],
    primaryMuscle: "Triceps",
    name: "Triceps pushdown",
    category: "upper",
    equipmentNote: "Cable stack, rope or straight bar, elbows pinned to your sides",
    defaultSets: 3,
    repLow: 10,
    repHigh: 15,
    startWeightKg: 10,
  },
  {
    slug: "face_pull",
    equipment: ["machine"],
    primaryMuscle: "Shoulders",
    secondaryMuscles: ["Rear delts", "Rotator cuff"],
    name: "Face pull",
    category: "upper",
    equipmentNote: "Rope attachment at head height, pull toward the face, elbows high",
    tempoNote: "Slow and controlled, shoulder health work, not a rep-max",
    defaultSets: 3,
    repLow: 15,
    repHigh: 20,
    startWeightKg: 7.5,
  },
  {
    slug: "assisted_pull_up",
    equipment: ["machine"],
    primaryMuscle: "Back",
    secondaryMuscles: ["Biceps", "Core"],
    name: "Assisted pull-up machine",
    category: "upper",
    equipmentNote:
      "Counterweight or band-assist machine, start with more assistance, reduce it as you get stronger (more assistance weight makes the rep easier, not harder)",
    defaultSets: 3,
    repLow: 6,
    repHigh: 10,
  },
];

export const EXERCISE_BY_SLUG: Record<string, ExerciseDef> = Object.fromEntries(
  EXERCISES.map((e) => [e.slug, e])
);

// ── Slot variants ──────────────────────────────────────────────────────────────
// Ranked equipment-gated alternatives per movement pattern, best-equipped
// first, each list ending in a `[]` (bodyweight) entry so resolveSlotVariant
// can never fail to pick something. Reserved for the primary compound slots
// below — accessory slots stay single-exercise and are equipment-fit-gated
// instead (see the equipment-fit filter in session.ts): dropping an
// accessory when the kit isn't there mirrors how duration-fit already drops
// accessories for time, rather than growing this list without bound.
// Achilles-role slots never get a `variants` list — that work is rehab, not
// filler, and must never be swapped by equipment selection.

const SQUAT_VARIANTS: SlotVariant[] = [
  { exerciseSlug: "barbell_back_squat", equipment: ["barbell"] },
  { exerciseSlug: "db_squat", equipment: ["dumbbell"] },
  { exerciseSlug: "kettlebell_squat", equipment: ["kettlebell"] },
  { exerciseSlug: "air_squat", equipment: [], repLow: 15, repHigh: 25 },
];

const HINGE_VARIANTS: SlotVariant[] = [
  { exerciseSlug: "barbell_straight_leg_deadlift", equipment: ["barbell"] },
  { exerciseSlug: "romanian_deadlift", equipment: ["dumbbell"] },
  { exerciseSlug: "kettlebell_deadlift", equipment: ["kettlebell"] },
  { exerciseSlug: "band_deadlift", equipment: ["band"], repLow: 12, repHigh: 20 },
  { exerciseSlug: "hip_raise", equipment: [], repLow: 15, repHigh: 25 },
];

const HIP_THRUST_VARIANTS: SlotVariant[] = [
  { exerciseSlug: "barbell_hip_thrust_with_bench", equipment: ["barbell", "bench"] },
  { exerciseSlug: "glute_bridge", equipment: ["dumbbell"] },
  { exerciseSlug: "band_glute_bridge", equipment: ["band"], repLow: 12, repHigh: 20 },
  { exerciseSlug: "hip_raise", equipment: [], repLow: 15, repHigh: 25 },
];

const HORIZONTAL_PRESS_VARIANTS: SlotVariant[] = [
  { exerciseSlug: "barbell_bench_press", equipment: ["barbell", "bench"] },
  { exerciseSlug: "barbell_floor_press", equipment: ["barbell"] },
  { exerciseSlug: "dumbbell_bench_press", equipment: ["dumbbell", "bench"] },
  { exerciseSlug: "floor_press", equipment: ["dumbbell"] },
  { exerciseSlug: "push_up", equipment: [], repLow: 8, repHigh: 20 },
];

const OVERHEAD_PRESS_VARIANTS: SlotVariant[] = [
  { exerciseSlug: "barbell_shoulder_press", equipment: ["barbell"] },
  { exerciseSlug: "overhead_press", equipment: ["dumbbell"] },
  { exerciseSlug: "pike_push_up", equipment: [], repLow: 6, repHigh: 12 },
];

// Bent-over row (the two-hand back row slot).
const ROW_VARIANTS: SlotVariant[] = [
  { exerciseSlug: "pull_up", equipment: ["pullup_bar"], repLow: 4, repHigh: 10 },
  { exerciseSlug: "barbell_row", equipment: ["barbell"] },
  { exerciseSlug: "bent_over_row", equipment: ["dumbbell"] },
  { exerciseSlug: "kettlebell_row", equipment: ["kettlebell"] },
  { exerciseSlug: "band_row", equipment: ["band"], repLow: 12, repHigh: 20 },
  { exerciseSlug: "superman_from_floor", equipment: [], repLow: 10, repHigh: 15 },
];

// Renegade row (upper day's single-arm/anti-rotation row slot).
const RENEGADE_ROW_VARIANTS: SlotVariant[] = [
  { exerciseSlug: "kettlebell_row", equipment: ["kettlebell"] },
  { exerciseSlug: "renegade_row", equipment: ["dumbbell"] },
  { exerciseSlug: "band_row", equipment: ["band"], repLow: 12, repHigh: 20 },
  { exerciseSlug: "superman_from_floor", equipment: [], repLow: 10, repHigh: 15 },
];

// One-arm row (full-body day's single-arm row slot).
const ONE_ARM_ROW_VARIANTS: SlotVariant[] = [
  { exerciseSlug: "kettlebell_row", equipment: ["kettlebell"] },
  { exerciseSlug: "one_arm_row", equipment: ["dumbbell", "chair"] },
  { exerciseSlug: "band_row", equipment: ["band"], repLow: 12, repHigh: 20 },
  { exerciseSlug: "superman_from_floor", equipment: [], repLow: 10, repHigh: 15 },
];

// Complaint-targeted work (see TARGETED_WORK below) — same shortcut-over-a-
// list shape as the ordinary movement-pattern variants, so a knee/hamstring
// complaint still resolves to something an athlete with no box or chair can
// actually do, instead of a slot they can never complete.
const KNEE_TARGETED_VARIANTS: SlotVariant[] = [
  { exerciseSlug: "step_down", equipment: ["box"] },
  { exerciseSlug: "wall_sit", equipment: [], repLow: 30, repHigh: 45 },
];

const HAMSTRING_TARGETED_VARIANTS: SlotVariant[] = [
  { exerciseSlug: "nordic_curl_negative", equipment: ["chair"] },
  { exerciseSlug: "single_leg_glute_bridge", equipment: [], repLow: 10, repHigh: 15, perSide: true },
];

// ── Accessory-slot machine upgrades ───────────────────────────────────────────
// Ranked machine-first, existing exercise second: an athlete with a box's
// worth of free weights (but no machine) still gets exactly what they got
// before machines existed, while a full-gym athlete's accessory work
// actually changes. Deliberately limited to isolation/accessory slots, not
// the compound squat/hinge/press/row variant chains above — a machine is a
// better fit for finishing volume than for the main lift itself.
const CALF_RAISE_ACCESSORY_VARIANTS: SlotVariant[] = [
  { exerciseSlug: "calf_raise_machine", equipment: ["machine"] },
  { exerciseSlug: "standing_calf_raise", equipment: ["dumbbell"] },
];

// Split squat's quad-accessory role, machine-upgraded to a seated leg
// extension when one's available.
const SPLIT_SQUAT_ACCESSORY_VARIANTS: SlotVariant[] = [
  { exerciseSlug: "leg_extension_machine", equipment: ["machine"], repLow: 12, repHigh: 20 },
  { exerciseSlug: "bulgarian_split_squat", equipment: ["dumbbell", "chair"], repLow: 15, repHigh: 25 },
];

// Single-leg RDL's hamstring-accessory role, machine-upgraded to a leg curl.
const SINGLE_LEG_RDL_ACCESSORY_VARIANTS: SlotVariant[] = [
  { exerciseSlug: "leg_curl_machine", equipment: ["machine"], repLow: 10, repHigh: 15, perSide: false },
  { exerciseSlug: "single_leg_rdl", equipment: ["dumbbell"], repLow: 15, repHigh: 25, perSide: true },
];

// Lateral raise's shoulder-accessory role, machine-upgraded to a cable face
// pull — trades side-delt isolation for rear-delt/rotator-cuff health work,
// but fills the same "small shoulder accessory" slot in the session.
const LATERAL_RAISE_ACCESSORY_VARIANTS: SlotVariant[] = [
  { exerciseSlug: "face_pull", equipment: ["machine"], repLow: 15, repHigh: 20 },
  { exerciseSlug: "lateral_raise", equipment: ["dumbbell"], repLow: 12, repHigh: 15 },
];

/**
 * Which concrete exercise a template slot resolves to for this athlete.
 *
 * `equipment === null` means "no equipment info yet" (unconfigured Kraft
 * settings) — always the slot's own base prescription (`exerciseSlug`),
 * matching the exact pre-equipment-aware behaviour so unconfigured athletes
 * and every existing caller keep getting exactly what they got before
 * variants existed.
 *
 * When equipment is known, ranked `variants` (best first) are tried in
 * order; the first whose required kit is fully available wins. A slot with
 * no `variants` list (Achilles-role slots, and slots deliberately left
 * single-exercise) always resolves to its base `exerciseSlug` regardless of
 * equipment — variant selection never touches Achilles work.
 *
 * `usedSlugs` (optional) is the set of exercise slugs already resolved
 * earlier in this same session — when given, the best equipment-satisfying
 * variant NOT already in that set wins instead, walking down the chain one
 * step (see session.ts buildSessionPlan: this is what stops two slots that
 * share a bodyweight/machine-less floor, e.g. the hinge and hip-thrust
 * patterns both bottoming out at the bodyweight hip raise, from prescribing
 * the same exercise twice). `duplicate: true` means every equipment-
 * satisfying candidate was already used — the caller decides whether that's
 * acceptable (protected achilles/targeted work) or means dropping the slot.
 */
export function resolveSlotVariant(
  slot: TemplateSlot,
  equipment: Equipment[] | null,
  usedSlugs?: Set<string>
): { slug: string; sets: number; repLow: number; repHigh: number; perSide: boolean; duplicate: boolean } {
  const base = {
    slug: slot.exerciseSlug,
    sets: slot.sets,
    repLow: slot.repLow,
    repHigh: slot.repHigh,
    perSide: slot.perSide ?? false,
  };
  if (equipment == null || !slot.variants || slot.variants.length === 0) {
    return { ...base, duplicate: false };
  }

  const has = (needs: Equipment[]) => needs.every((e) => equipment.includes(e));
  const candidates = slot.variants.filter((v) => has(v.equipment));
  if (candidates.length === 0) return { ...base, duplicate: false };

  const fresh = usedSlugs ? candidates.find((v) => !usedSlugs.has(v.exerciseSlug)) : candidates[0];
  const match = fresh ?? candidates[0];

  return {
    slug: match.exerciseSlug,
    sets: match.sets ?? base.sets,
    repLow: match.repLow ?? base.repLow,
    repHigh: match.repHigh ?? base.repHigh,
    perSide: match.perSide ?? base.perSide,
    duplicate: !fresh && !!usedSlugs && usedSlugs.has(match.exerciseSlug),
  };
}

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
    title: "Upper · Kraft",
    targetDurationMinutes: 40,
    effortNote: "1-2 reps in reserve on the last set of each exercise",
    slots: [
      { exerciseSlug: "overhead_press", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90, variants: OVERHEAD_PRESS_VARIANTS },
      { exerciseSlug: "bent_over_row", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90, variants: ROW_VARIANTS },
      { exerciseSlug: "floor_press", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90, variants: HORIZONTAL_PRESS_VARIANTS },
      { exerciseSlug: "renegade_row", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90, variants: RENEGADE_ROW_VARIANTS },
      { exerciseSlug: "curl_to_press", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90, priority: "accessory" },
      { exerciseSlug: "lateral_raise", sets: 3, repLow: 12, repHigh: 15, restSeconds: 60, priority: "accessory", variants: LATERAL_RAISE_ACCESSORY_VARIANTS },
    ],
  },
  lower: {
    type: "lower",
    title: "Lower · Kraft",
    targetDurationMinutes: 35,
    effortNote: "1-2 reps in reserve on the last set of each exercise",
    slots: [
      { exerciseSlug: "db_squat", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90, variants: SQUAT_VARIANTS },
      { exerciseSlug: "romanian_deadlift", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90, variants: HINGE_VARIANTS },
      { exerciseSlug: "bulgarian_split_squat", sets: 3, repLow: 15, repHigh: 25, restSeconds: 90, perSide: true, priority: "accessory", variants: SPLIT_SQUAT_ACCESSORY_VARIANTS },
      { exerciseSlug: "single_leg_rdl", sets: 3, repLow: 15, repHigh: 25, restSeconds: 90, perSide: true, priority: "accessory", variants: SINGLE_LEG_RDL_ACCESSORY_VARIANTS },
      // Ordinary runner calf work — not the Achilles HSR protocol.
      { exerciseSlug: "standing_calf_raise", sets: 3, repLow: 12, repHigh: 15, restSeconds: 60, priority: "accessory", variants: CALF_RAISE_ACCESSORY_VARIANTS },
    ],
  },
  full_body: {
    type: "full_body",
    title: "Full Body",
    targetDurationMinutes: 38,
    effortNote: "1-2 reps in reserve on the last set of each exercise",
    slots: [
      // Same squat pattern as the lower day (goblet_squat's dumbbell entry
      // stays in the catalogue for the custom builder, just no longer the
      // only option a full-body session can resolve to).
      { exerciseSlug: "db_squat", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90, variants: SQUAT_VARIANTS },
      { exerciseSlug: "romanian_deadlift", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90, variants: HINGE_VARIANTS },
      { exerciseSlug: "floor_press", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90, variants: HORIZONTAL_PRESS_VARIANTS },
      { exerciseSlug: "one_arm_row", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90, perSide: true, variants: ONE_ARM_ROW_VARIANTS },
      { exerciseSlug: "overhead_press", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90, priority: "accessory", variants: OVERHEAD_PRESS_VARIANTS },
      { exerciseSlug: "glute_bridge", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90, priority: "accessory", variants: HIP_THRUST_VARIANTS },
      // Ordinary runner calf work — not the Achilles HSR protocol.
      { exerciseSlug: "standing_calf_raise", sets: 3, repLow: 12, repHigh: 15, restSeconds: 60, priority: "accessory", variants: CALF_RAISE_ACCESSORY_VARIANTS },
    ],
  },
  upper_achilles: {
    type: "upper_achilles",
    title: "Upper + Achilles · Kraft",
    targetDurationMinutes: 50,
    effortNote: "1-2 reps in reserve on upper; explosive step-ups at 6 reps only",
    slots: [
      // Upper
      { exerciseSlug: "overhead_press", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90, variants: OVERHEAD_PRESS_VARIANTS },
      { exerciseSlug: "bent_over_row", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90, variants: ROW_VARIANTS },
      { exerciseSlug: "floor_press", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90, variants: HORIZONTAL_PRESS_VARIANTS },
      { exerciseSlug: "curl_to_press", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90, priority: "accessory" },
      // Achilles: explosive first, then HSR — never variant-swapped.
      { exerciseSlug: "explosive_box_step_up", sets: 3, repLow: 6, repHigh: 6, restSeconds: 90, perSide: true },
      { exerciseSlug: "straight_knee_calf_raise", sets: 3, repLow: 8, repHigh: 12, restSeconds: 120 },
      { exerciseSlug: "bent_knee_calf_raise", sets: 3, repLow: 8, repHigh: 12, restSeconds: 120 },
    ],
  },
  achilles: {
    type: "achilles",
    title: "Achilles · Kraft",
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
    title: "Lower + Achilles · Kraft",
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
      { exerciseSlug: "db_squat", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90, variants: SQUAT_VARIANTS },
      { exerciseSlug: "romanian_deadlift", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90, variants: HINGE_VARIANTS },
      { exerciseSlug: "bulgarian_split_squat", sets: 3, repLow: 15, repHigh: 25, restSeconds: 90, perSide: true, priority: "accessory", variants: SPLIT_SQUAT_ACCESSORY_VARIANTS },
      { exerciseSlug: "single_leg_rdl", sets: 3, repLow: 15, repHigh: 25, restSeconds: 90, perSide: true, priority: "accessory", variants: SINGLE_LEG_RDL_ACCESSORY_VARIANTS },
      // Glute bridge last
      { exerciseSlug: "glute_bridge", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90, priority: "accessory", variants: HIP_THRUST_VARIANTS },
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
    // step_down hard-requires a box; targeted work is protected like
    // Achilles work (never dropped for missing equipment), so it needs a
    // bodyweight fallback — see KNEE_TARGETED_VARIANTS.
    slot: {
      sets: 3,
      repLow: 8,
      repHigh: 12,
      restSeconds: 90,
      perSide: true,
      priority: "targeted",
      variants: KNEE_TARGETED_VARIANTS,
    },
    sessionTypes: ["lower", "full_body"],
  },
  itb: {
    slug: "side_lying_leg_raise",
    slot: { sets: 3, repLow: 12, repHigh: 20, restSeconds: 60, perSide: true, priority: "targeted" },
    sessionTypes: ["lower", "full_body"],
  },
  hamstring: {
    slug: "nordic_curl_negative",
    // nordic_curl_negative hard-requires a chair — same protection/fallback
    // reasoning as knee/step_down above (HAMSTRING_TARGETED_VARIANTS).
    slot: {
      sets: 3,
      repLow: 5,
      repHigh: 8,
      restSeconds: 120,
      priority: "targeted",
      variants: HAMSTRING_TARGETED_VARIANTS,
    },
    sessionTypes: ["lower", "full_body"],
  },
  hip_glute: {
    slug: "clamshell",
    slot: { sets: 3, repLow: 15, repHigh: 20, restSeconds: 45, perSide: true, priority: "targeted" },
    sessionTypes: ["lower", "full_body"],
  },
};

// ── Growth candidates (see duration-fit.ts) ──────────────────────────────────
// Which exercise categories "complement" a given session type when
// duration-fit needs to introduce a brand-new exercise instead of piling
// more sets onto what's already there. full_body already draws its own
// template from all three, so it stays open to all three when growing too;
// upper/lower stay within their own category — a longer Upper day should not
// start adding squats. achilles/upper_achilles/lower_achilles are the
// historic dedicated-rehab types (see the comment above sessionTemplateFor)
// and are intentionally absent: nothing "complements" a rehab session, and
// they're no longer offered on the picker.
const CATEGORIES_FOR_SESSION_TYPE: Partial<Record<StrengthSessionType, StrengthCategory[]>> = {
  upper: ["upper"],
  lower: ["lower"],
  full_body: ["upper", "lower", "full_body"],
};

// Complaint-targeted exercises (TARGETED_WORK above) have their own
// prescribed dose and are only ever added when the athlete reported that
// specific complaint — they must never double as generic filler for an
// athlete who didn't.
const TARGETED_WORK_SLUGS = new Set(
  Object.values(TARGETED_WORK).map((t) => t!.slug)
);

/**
 * Extra exercises duration-fit.ts may introduce when a session has budget
 * left after its own exercises reach a sensible working volume (see
 * MAX_SETS_WORKING there): exercises that suit the session's own type (see
 * CATEGORIES_FOR_SESSION_TYPE) and that the athlete can actually perform.
 *
 * `equipment: null` (no equipment info yet, unconfigured Kraft settings)
 * falls back to bodyweight-only candidates — the safe default every other
 * unconfigured-equipment path in this file already uses, rather than
 * offering an exercise that turns out to need kit the athlete never
 * confirmed they have.
 *
 * Excludes Achilles-role exercises (that work is rehab with its own
 * prescribed dose, never generic filler) and complaint-targeted exercises
 * (see TARGETED_WORK_SLUGS above). Order is the catalogue's own order —
 * duration-fit.ts breaks ties by muscle-group balance, not by this order.
 */
export function growthCandidatesFor(
  type: StrengthSessionType,
  equipment: Equipment[] | null
): ExerciseDef[] {
  const categories = CATEGORIES_FOR_SESSION_TYPE[type];
  if (!categories) return [];
  return EXERCISES.filter((ex) => {
    if (!categories.includes(ex.category)) return false;
    if (ex.achillesRole) return false;
    if (TARGETED_WORK_SLUGS.has(ex.slug)) return false;
    const needs = ex.equipment ?? [];
    if (equipment == null) return needs.length === 0;
    return needs.every((e) => equipment.includes(e));
  });
}

const ACHILLES_SESSION_TYPES = new Set<StrengthSessionType>([
  "achilles",
  "lower_achilles",
  "upper_achilles",
]);

// ── Achilles complaint block ──────────────────────────────────────────────────
// The dedicated achilles/lower_achilles/upper_achilles session TYPES are no
// longer offered on the picker (see strength/page.tsx PICKER_TYPES) — a Kraft
// picker showing three Achilles-rehab cards to an athlete with no Achilles
// problem was the bug being fixed here. Those types are kept exactly as they
// were (SESSION_TEMPLATES above, ACHILLES_SESSION_TYPES branch below) purely
// so historic sessions of those types still load and render correctly.
//
// Going forward, an "achilles" complaint reshapes the ordinary upper/lower/
// full_body sessions instead — same explosive-then-slow-heavy block the old
// dedicated types used (order matters: see validateAchillesOrdering in
// session.ts), injected as extra slots the same way TARGETED_WORK injects
// other complaints' work below, just with more than one slot and its own
// fixed internal order.
const ACHILLES_COMPLAINT_SLOTS: TemplateSlot[] = [
  { exerciseSlug: "explosive_box_step_up", sets: 3, repLow: 6, repHigh: 6, restSeconds: 90, perSide: true },
  { exerciseSlug: "straight_knee_calf_raise", sets: 3, repLow: 8, repHigh: 12, restSeconds: 120 },
  { exerciseSlug: "bent_knee_calf_raise", sets: 3, repLow: 8, repHigh: 12, restSeconds: 120 },
  { exerciseSlug: "loaded_toe_walk", sets: 3, repLow: 1, repHigh: 1, restSeconds: 120 },
];

/**
 * The session template an athlete actually gets for `type`, given their
 * reported complaints. Achilles session types (historic only, see above) are
 * always returned unchanged. For every other session type, an "achilles"
 * complaint appends the Achilles/HSR block above, and each other reported
 * complaint whose `TARGETED_WORK` entry lists `type` appends its own slot.
 */
export function sessionTemplateFor(
  type: StrengthSessionType,
  complaints: Complaint[] = []
): SessionTemplate {
  const template = SESSION_TEMPLATES[type];
  if (ACHILLES_SESSION_TYPES.has(type)) return template;

  const extraSlots: TemplateSlot[] = [];
  const seen = new Set<string>();
  if (complaints.includes("achilles")) {
    for (const slot of ACHILLES_COMPLAINT_SLOTS) {
      seen.add(slot.exerciseSlug);
      extraSlots.push(slot);
    }
  }
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

// ── Running-focus goal ────────────────────────────────────────────────────────
// Exercises that train the hinge/hip-thrust (posterior chain) or a unilateral
// leg pattern — the movements a runner gets the most transfer from. A
// "running_focus" goal (see types.ts Goal) adds a set to these and trims a
// set from ordinary upper-body work (session.ts buildSessionPlan), instead of
// collecting the goal and never acting on it.
export const RUNNING_FOCUS_POSTERIOR_CHAIN_SLUGS = new Set([
  "romanian_deadlift",
  "single_leg_rdl",
  "barbell_straight_leg_deadlift",
  "kettlebell_deadlift",
  "band_deadlift",
  "hip_raise",
  "glute_bridge",
  "single_leg_hip_thrust",
  "barbell_hip_thrust_with_bench",
  "band_glute_bridge",
  "kettlebell_swing",
  "nordic_curl_negative",
  "leg_curl_machine",
  "bulgarian_split_squat",
  "barbell_bulgarian_split_squat",
  "reverse_lunge",
  "barbell_reverse_lunge",
  "single_leg_glute_bridge",
]);

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

import type { ExerciseDef } from "./types";
import { snapToLevel } from "./weights";

// ── Personalised cold-start load model ────────────────────────────────────────
//
// Before any history exists, `startWeightKg` on the exercise catalogue is a
// single global number (e.g. goblet squat 8 kg) that ignores body mass, sex,
// and training age entirely. This module derives a per-lifter starting load
// instead, so a 75 kg novice male isn't handed a warm-up weight and a 50 kg
// novice isn't handed something dangerous.
//
// The model is intentionally simple and conservative — it only has to get the
// FIRST session in the right ballpark; real progression (progression.ts) takes
// over from the second logged session and is untouched by this module. Erring
// light is the safe failure mode, so every constant below was chosen at the
// low end of what's commonly cited for novice dumbbell training.
//
// Falls back to the exercise's global `startWeightKg` whenever the profile is
// incomplete (missing bodyweight), so nothing regresses for users who skip the
// setup questions — this is a pure function, no I/O, easy to unit test.

export type LifterSex = "male" | "female" | "unspecified";
/** Reuses the strength-setup wizard's "ability" vocabulary as training age. */
export type LifterExperience = "beginner" | "intermediate" | "advanced";

export interface LifterProfile {
  /** Bodyweight in kg. Missing/null → model can't personalise, use fallback. */
  bodyweightKg?: number | null;
  sex?: LifterSex | null;
  /** beginner ≈ "none", intermediate ≈ "some", advanced ≈ "experienced". */
  experience?: LifterExperience | null;
}

type MovementPattern =
  | "squat"
  | "hinge"
  | "unilateral_hinge"
  | "lunge"
  | "row"
  | "press_overhead"
  | "press_horizontal"
  | "hip_bridge"
  | "calf_raise"
  | "carry"
  | "isolation";

// Movement pattern per exercise slug. Only loaded (non-bodyweight) exercises
// need an entry; anything missing falls back to the global startWeightKg.
const PATTERN_BY_SLUG: Partial<Record<string, MovementPattern>> = {
  overhead_press: "press_overhead",
  bent_over_row: "row",
  floor_press: "press_horizontal",
  renegade_row: "row",
  curl_to_press: "press_overhead",
  lateral_raise: "isolation",
  db_squat: "squat",
  romanian_deadlift: "hinge",
  bulgarian_split_squat: "lunge",
  single_leg_rdl: "unilateral_hinge",
  explosive_box_step_up: "lunge",
  loaded_toe_walk: "carry",
  straight_knee_calf_raise: "calf_raise",
  bent_knee_calf_raise: "calf_raise",
  goblet_squat: "squat",
  one_arm_row: "row",
  glute_bridge: "hip_bridge",
  db_floor_fly: "isolation",
  bicep_curl: "isolation",
  hammer_curl: "isolation",
  overhead_triceps_extension: "isolation",
  triceps_kickback: "isolation",
  front_raise: "isolation",
  rear_delt_fly: "isolation",
  arnold_press: "press_overhead",
  db_pullover: "isolation",
  db_shrug: "isolation",
  reverse_lunge: "lunge",
  sumo_squat: "squat",
  russian_twist: "isolation",
  weighted_situp: "isolation",
};

// Base multiplier = load per dumbbell as a fraction of bodyweight, calibrated
// to an "intermediate" (some experience) male lifter — the experience and sex
// factors below scale away from that anchor. Sources: these track the low end
// of commonly cited novice dumbbell-training ranges (e.g. goblet squat and RDL
// around 15-20% BW per hand/implement, presses well under that because
// shoulder strength lags leg/back strength, isolation work a small fraction
// since it targets single small muscle groups). Deliberately conservative.
const BASE_MULTIPLIER: Record<MovementPattern, number> = {
  squat: 0.2, // single dumbbell held at chest (goblet-style)
  hinge: 0.2, // one dumbbell per hand
  unilateral_hinge: 0.15, // single-leg balance demand — lighter than bilateral
  lunge: 0.12, // split-stance, per hand
  row: 0.15, // per hand / per single dumbbell
  press_overhead: 0.1, // hardest lift relative to bodyweight
  press_horizontal: 0.13, // more stable, bigger muscle mass than OHP
  hip_bridge: 0.18, // single dumbbell on hips, big stable muscle group
  calf_raise: 0.2, // calves tolerate relatively heavy loads
  carry: 0.3, // loaded carry, both hands
  isolation: 0.06, // single-joint, small muscle groups (curls, raises)
};

const SEX_FACTOR: Record<LifterSex, number> = {
  male: 1.0,
  // Conservative uniform female factor; real ratios vary by movement, but a
  // single light-side constant is safer than pattern-specific guesses here.
  female: 0.7,
  unspecified: 0.85,
};

const EXPERIENCE_FACTOR: Record<LifterExperience, number> = {
  beginner: 0.75, // "none" — hasn't built movement competence under load yet
  intermediate: 1.0, // "some" — the calibration anchor
  advanced: 1.3, // "experienced" — confident with all complex movements
};

/**
 * Derive a personalised cold-start load (kg per dumbbell) for an exercise.
 * Returns `undefined` for bodyweight-only exercises (startWeightKg unset) —
 * never invent a load for those. Falls back to the exercise's global
 * `startWeightKg`, snapped to the ladder, whenever the profile is incomplete
 * or the exercise has no known movement pattern.
 */
export function deriveStartWeightKg(
  exercise: ExerciseDef,
  profile: LifterProfile | null | undefined
): number | undefined {
  if (exercise.startWeightKg == null) return undefined; // bodyweight exercise

  const fallback = snapToLevel(exercise.startWeightKg);

  const bodyweightKg = profile?.bodyweightKg;
  if (!bodyweightKg || bodyweightKg <= 0) return fallback;

  const pattern = PATTERN_BY_SLUG[exercise.slug];
  if (!pattern) return fallback;

  const sex = profile?.sex ?? "unspecified";
  const experience = profile?.experience ?? "intermediate";

  const raw =
    bodyweightKg * BASE_MULTIPLIER[pattern] * SEX_FACTOR[sex] * EXPERIENCE_FACTOR[experience];

  return snapToLevel(raw);
}

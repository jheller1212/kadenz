import { snapToLevel } from "./weights";

// ── Warm-up ramp ──────────────────────────────────────────────────────────────
//
// Suggests 0-2 pre-tagged warm-up sets ahead of a heavy compound lift's
// working sets, so the athlete corrects a ramp instead of building one from
// scratch every time. Kept deliberately narrow:
//
//   - Only "primary" slots (see session.ts PlannedExercise.priority) get a
//     ramp. Accessory/isolation work is the opposite of what a ramp is for —
//     light, single-joint, already short — and Achilles/targeted rehab
//     exercises follow their own load-bearing protocol (progression.ts /
//     program.ts), not a duration or effort knob a warm-up should touch.
//   - Bodyweight exercises (no suggestedWeightKg) never get a ramp — there's
//     no external load to ramp into, and a warm-up of "fewer reps of the same
//     bodyweight movement" isn't a real warm-up.
//   - Below WARMUP_THRESHOLD_KG the working weight is itself close to a
//     typical warm-up load, so ramping into it buys nothing and only adds
//     taps to a light session. 10 kg per dumbbell is roughly where this
//     app's own cold-start model (load-model.ts BASE_MULTIPLIER, anchored on
//     an intermediate lifter) starts recommending genuinely loaded compound
//     work, so it's already the app's implicit "this one counts" line.
//   - One ramp set (60% of the working weight) below RAMP_TWO_STEP_KG, two
//     ramp sets (50% then 75%) at or above it — a heavier working weight
//     benefits from an extra rung on the way up; a moderately heavy one
//     doesn't need it and a second light set would just be more taps.
//   - Ramp sets are prescribed at a flat, low rep count (RAMP_REPS), not the
//     exercise's own rep range — a warm-up primes the movement, it is never
//     meant to be taken anywhere near the working set's effort or failure.
//
// Weights snap to the same dumbbell ladder as every other prescribed load
// (weights.ts), so a ramp set is always something the athlete can actually
// load.

export const WARMUP_THRESHOLD_KG = 10;
export const RAMP_TWO_STEP_KG = 17.5;
export const RAMP_REPS = 6;

/** Mirrors session.ts PlannedExercise.priority without importing that
 *  module's server-only dependency tree into client code. */
export type WarmupEligiblePriority = "primary" | "accessory" | "achilles" | "targeted";

export interface WarmupRampSet {
  kg: number;
  reps: number;
}

/**
 * Derive the warm-up ramp for one exercise, or [] when none is warranted.
 * `workingWeightKg` is the suggested/current working weight per dumbbell
 * (the same number progression.ts and load-model.ts already reason about).
 */
export function deriveWarmupRamp(
  priority: WarmupEligiblePriority | undefined,
  workingWeightKg: number | null | undefined
): WarmupRampSet[] {
  if (priority !== "primary") return [];
  if (workingWeightKg == null || workingWeightKg < WARMUP_THRESHOLD_KG) return [];

  if (workingWeightKg < RAMP_TWO_STEP_KG) {
    return [{ kg: snapToLevel(workingWeightKg * 0.6), reps: RAMP_REPS }];
  }
  return [
    { kg: snapToLevel(workingWeightKg * 0.5), reps: RAMP_REPS },
    { kg: snapToLevel(workingWeightKg * 0.75), reps: RAMP_REPS },
  ];
}

/**
 * Same ramp, gated by the athlete's "suggest warm-up sets" preference
 * (UserSettings.kraftWarmupSuggestions). Kept separate from deriveWarmupRamp
 * itself so the ramp maths above stay a pure function of load — this is
 * purely an on/off switch GuidedSession.tsx's buildWork (and the
 * exchange-exercise path) calls instead, never the maths.
 *
 * Off means "stop suggesting", not "warm-ups don't exist": hand-tagging a
 * set as a warm-up (toggleSetKind in GuidedSession.tsx) is untouched by this
 * flag either way.
 */
export function deriveWarmupRampIfEnabled(
  priority: WarmupEligiblePriority | undefined,
  workingWeightKg: number | null | undefined,
  suggestionsEnabled: boolean
): WarmupRampSet[] {
  if (!suggestionsEnabled) return [];
  return deriveWarmupRamp(priority, workingWeightKg);
}

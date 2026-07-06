import type { ExerciseDef, ExerciseSessionHistory, LoggedSet } from "./types";
import { nextWeight, prevWeight, snapToLevel, isTopLevel } from "./weights";

// ── Progression / deload engine ───────────────────────────────────────────────
//
// Business rules (from the handoff):
//   1. Progression: every working set of an exercise reaches the top of the rep
//      range (12) → suggest +1 dumbbell level next session. Never more than one
//      level at a time. Overhead press is a slow progressor (needs two clean
//      sessions in a row before bumping).
//   2. Deload: reps fall below the bottom of the range (8) on two consecutive
//      sessions → suggest −1 level.
//   3. Pain gate (Achilles): handled in `evaluatePainGate` below.

export type ProgressionAction = "increase" | "hold" | "decrease";

export interface ProgressionSuggestion {
  action: ProgressionAction;
  currentWeightKg: number | null;
  suggestedWeightKg: number | null;
  reason: string;
  atCeiling: boolean;
}

function workingSets(session: ExerciseSessionHistory | undefined): LoggedSet[] {
  if (!session) return [];
  return session.sets.filter((s) => s.reps != null);
}

/** True when every working set met or exceeded the top of the rep range. */
function allSetsAtTop(session: ExerciseSessionHistory | undefined, repHigh: number): boolean {
  const sets = workingSets(session);
  if (sets.length === 0) return false;
  return sets.every((s) => (s.reps ?? 0) >= repHigh);
}

/** True when any working set fell below the bottom of the rep range. */
function anySetBelowFloor(session: ExerciseSessionHistory | undefined, repLow: number): boolean {
  const sets = workingSets(session);
  if (sets.length === 0) return false;
  return sets.some((s) => (s.reps ?? 0) < repLow);
}

/** Heaviest load logged for the exercise in a session (kg), or null. */
function topWeight(session: ExerciseSessionHistory | undefined): number | null {
  const sets = workingSets(session);
  const weights = sets.map((s) => s.weightKg).filter((w): w is number => w != null && w > 0);
  if (weights.length === 0) return null;
  return Math.max(...weights);
}

/**
 * Suggest the next working weight for an exercise given its recent history.
 * `history` must be newest-first and contain only completed sessions that
 * logged this exercise.
 */
export function suggestProgression(
  exercise: ExerciseDef,
  history: ExerciseSessionHistory[]
): ProgressionSuggestion {
  const repHigh = exercise.repHigh ?? 12;
  const repLow = exercise.repLow ?? 8;

  const last = history[0];
  const prev = history[1];
  const current = topWeight(last);
  const atCeiling = current != null && isTopLevel(current);

  // No history yet → start at the prescribed weight (snapped to a real level).
  if (!last || workingSets(last).length === 0) {
    const start = exercise.startWeightKg != null ? snapToLevel(exercise.startWeightKg) : null;
    return {
      action: "hold",
      currentWeightKg: current,
      suggestedWeightKg: start,
      reason: "No logged history yet — start at the prescribed weight.",
      atCeiling: false,
    };
  }

  // Rule 2 — deload takes priority (safety before progress).
  if (anySetBelowFloor(last, repLow) && anySetBelowFloor(prev, repLow)) {
    const suggested = current != null ? prevWeight(current) : null;
    return {
      action: "decrease",
      currentWeightKg: current,
      suggestedWeightKg: suggested,
      reason: `Reps dropped below ${repLow} on two sessions in a row — drop one level.`,
      atCeiling,
    };
  }

  // Rule 1 — progression when the whole session hit the top of the range.
  if (allSetsAtTop(last, repHigh)) {
    // Slow progressors (e.g. overhead press) need two clean sessions in a row.
    if (exercise.slowProgressor && !allSetsAtTop(prev, repHigh)) {
      return {
        action: "hold",
        currentWeightKg: current,
        suggestedWeightKg: current,
        reason: `All sets at ${repHigh} reps — hold once more before bumping (slow progressor).`,
        atCeiling,
      };
    }
    if (atCeiling) {
      return {
        action: "hold",
        currentWeightKg: current,
        suggestedWeightKg: current,
        reason: "Already at the heaviest dumbbell level.",
        atCeiling,
      };
    }
    const suggested = current != null ? nextWeight(current) : null;
    return {
      action: "increase",
      currentWeightKg: current,
      suggestedWeightKg: suggested,
      reason: `All sets reached ${repHigh} reps — add one level.`,
      atCeiling,
    };
  }

  return {
    action: "hold",
    currentWeightKg: current,
    suggestedWeightKg: current,
    reason: "Keep the same weight and add reps toward the top of the range.",
    atCeiling,
  };
}

// ── Pain gate (Achilles) ─────────────────────────────────────────────────────
//
// Advisory only — no medical language. Triggers when an Achilles pain score is
// above 4, or a next-day check-in reports the load did not settle within 24 h.

export interface PainLogInput {
  score: number;
  timing: "during" | "after" | "next_day";
  settledWithin24h?: boolean | null;
}

export interface PainGateResult {
  triggered: boolean;
  reason: string | null;
}

export const PAIN_SCORE_THRESHOLD = 4;

export function evaluatePainGate(logs: PainLogInput[]): PainGateResult {
  const highScore = logs.find((l) => l.score > PAIN_SCORE_THRESHOLD);
  if (highScore) {
    return {
      triggered: true,
      reason: `Reported pain ${highScore.score}/10 — consider dropping one level on calf work next session.`,
    };
  }
  const didNotSettle = logs.find(
    (l) => l.timing === "next_day" && l.settledWithin24h === false
  );
  if (didNotSettle) {
    return {
      triggered: true,
      reason:
        "Load didn't settle within 24 h — consider dropping one level on calf work next session.",
    };
  }
  return { triggered: false, reason: null };
}

/**
 * Apply the pain-gate advisory to a calf-work progression suggestion: cap the
 * suggested load at one level below current (never increase while gated).
 */
export function applyPainGate(
  suggestion: ProgressionSuggestion,
  gate: PainGateResult
): ProgressionSuggestion {
  if (!gate.triggered) return suggestion;
  const current = suggestion.currentWeightKg;
  const suggested = current != null ? prevWeight(current) : suggestion.suggestedWeightKg;
  return {
    ...suggestion,
    action: "decrease",
    suggestedWeightKg: suggested,
    reason: gate.reason ?? suggestion.reason,
  };
}

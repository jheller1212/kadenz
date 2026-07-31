import type { Complaint, ExerciseDef, ExerciseSessionHistory, LoggedSet } from "./types";
import { COMPLAINT_SHORT_LABELS, STRENGTH_COMPLAINTS } from "./types";
import { nextWeight, prevWeight, isTopLevel } from "./weights";
import { deriveStartWeightKg, type LifterProfile } from "./load-model";

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

/**
 * The sets the progression signal is allowed to read.
 *
 * This used to filter on `reps != null` alone, so warm-ups counted as working
 * sets despite the name. That inverted the whole model: allSetsAtTop requires
 * EVERY set to reach the top of the rep range, so a single light ramp set made
 * an increase impossible, and anySetBelowFloor fires on any set under the
 * floor, so warming up across two sessions suggested a DECREASE. Warming up
 * properly made the app take weight off the bar.
 *
 * `kind` is null on every row logged before it existed, and null reads as
 * working, so historical sessions keep the meaning they already had.
 */
function workingSets(session: ExerciseSessionHistory | undefined): LoggedSet[] {
  if (!session) return [];
  return session.sets.filter((s) => s.reps != null && s.kind !== "warmup");
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
  history: ExerciseSessionHistory[],
  lifterProfile?: LifterProfile | null
): ProgressionSuggestion {
  const repHigh = exercise.repHigh ?? 12;
  const repLow = exercise.repLow ?? 8;

  const last = history[0];
  const prev = history[1];
  const current = topWeight(last);
  const atCeiling = current != null && isTopLevel(current);

  // No history yet → start at a personalised load (bodyweight, sex, training
  // age) when available, falling back to the global prescribed weight.
  if (!last || workingSets(last).length === 0) {
    const start = deriveStartWeightKg(exercise, lifterProfile) ?? null;
    return {
      action: "hold",
      currentWeightKg: current,
      suggestedWeightKg: start,
      reason: "No logged history yet, start at the prescribed weight.",
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
      reason: `Reps dropped below ${repLow} on two sessions in a row, drop one level.`,
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
        reason: `All sets at ${repHigh} reps, hold once more before bumping (slow progressor).`,
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
      reason: `All sets reached ${repHigh} reps, add one level.`,
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
      reason: `Reported pain ${highScore.score}/10, consider dropping one level on calf work next session.`,
    };
  }
  const didNotSettle = logs.find(
    (l) => l.timing === "next_day" && l.settledWithin24h === false
  );
  if (didNotSettle) {
    return {
      triggered: true,
      reason:
        "Load didn't settle within 24 h, consider dropping one level on calf work next session.",
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

// ── Pain gate (non-Achilles complaints) ──────────────────────────────────────
//
// The gate above only ever eased calf work, so a knee or hamstring complaint
// could be logged and change nothing — worse than not asking, since the
// athlete reasonably expects a "niggle" report to do something. This mirrors
// the same rule (score above threshold, or a next-day check-in that didn't
// settle) per complaint instead of globally, so it only eases the work that
// complaint actually added (see complaint-work.ts complaintWorkSlugs).
// "achilles" is deliberately excluded — it keeps evaluatePainGate/
// applyPainGate/getPainGate above untouched, with its own week-based ramp
// and locked HSR sets.

export interface ComplaintPainLogInput extends PainLogInput {
  /** The complaint(s) the session this log belongs to was built for (frozen
   *  strengthSessions.complaints, or the athlete's current settings for a
   *  session that never froze one — see complaint-work.ts effectiveComplaints).
   *  A log whose session covered several complaints feeds the gate for each
   *  of them, since pain_logs has no per-exercise link to say which one. */
  complaints: Complaint[];
}

function evaluatePainGateForComplaint(
  logs: PainLogInput[],
  complaint: Exclude<Complaint, "achilles">
): PainGateResult {
  const label = COMPLAINT_SHORT_LABELS[complaint];
  const highScore = logs.find((l) => l.score > PAIN_SCORE_THRESHOLD);
  if (highScore) {
    return {
      triggered: true,
      reason: `Reported ${label} pain ${highScore.score}/10, easing ${label} work this session.`,
    };
  }
  const didNotSettle = logs.find(
    (l) => l.timing === "next_day" && l.settledWithin24h === false
  );
  if (didNotSettle) {
    return {
      triggered: true,
      reason: `${label} pain didn't settle within 24 h, easing ${label} work this session.`,
    };
  }
  return { triggered: false, reason: null };
}

/** Per-complaint version of evaluatePainGate, keyed by every reported
 *  complaint except "achilles" (see header comment above). Only complaints
 *  with at least one own log are present in the result. */
export function evaluateComplaintPainGates(
  logs: ComplaintPainLogInput[]
): Partial<Record<Exclude<Complaint, "achilles">, PainGateResult>> {
  const result: Partial<Record<Exclude<Complaint, "achilles">, PainGateResult>> = {};
  for (const complaint of STRENGTH_COMPLAINTS) {
    if (complaint === "achilles") continue;
    const own = logs.filter((l) => l.complaints.includes(complaint));
    if (own.length === 0) continue;
    const gate = evaluatePainGateForComplaint(own, complaint);
    if (gate.triggered) result[complaint] = gate;
  }
  return result;
}

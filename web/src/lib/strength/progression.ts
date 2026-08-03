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
  // reps == null already excludes "skipped" rows (they're logged with no
  // reps — see db/schema.ts strength_sets.kind), but kind is checked
  // explicitly too so that stays true even if a future caller ever sends a
  // skipped row with a stray reps value.
  return session.sets.filter(
    (s) => s.reps != null && s.kind !== "warmup" && s.kind !== "skipped"
  );
}

/** Working sets logged beyond the prescription this session ("log one
 *  more" — see guided-sets.ts). Evidence of capacity, read separately from
 *  workingSets() below so it can nudge a `hold` toward `increase` without
 *  being required for the ordinary top-of-range check to pass. */
function extraSets(session: ExerciseSessionHistory | undefined): LoggedSet[] {
  if (!session) return [];
  return session.sets.filter((s) => s.reps != null && s.kind === "extra");
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
 * A transition-guard window (see `phaseTransitionGuard` below), expressed as
 * "reps clearly outside the current range" rather than a hard cliff at the
 * boundary — a single rep over/under is ordinary variance, not evidence the
 * set was logged under a different rep target entirely.
 */
const TRANSITION_GUARD_SLACK = 2;

/**
 * Detects a phase-transition session: the last logged session's reps sit
 * clearly outside a sane window around the CURRENT prescribed range, which
 * means they were plainly logged under a different rep target (e.g. a
 * base-phase 10-12 session becoming `history[0]` for the first build-phase
 * call judged against 4-6). In that case the session is not evidence for or
 * against the current range, so progression should hold rather than read it
 * as either a clean top-of-range pass or a floor failure.
 *
 * Threshold: every working set has to fall more than `TRANSITION_GUARD_SLACK`
 * (2) reps outside [repLow, repHigh] for the guard to trip. Two reps of slack
 * absorbs ordinary set-to-set variance and off-by-one logging within the same
 * range (e.g. 7 reps against an 8-12 range is not a transition), while a
 * genuine phase jump — base 10-12 read against a build 4-6 target, or vice
 * versa — clears it by a wide margin (10 is 4 reps above repHigh+2=8 in the
 * 4-6 example). Every set has to clear it, not just one, so a single
 * mis-logged rep can't itself trigger the guard.
 */
function isPhaseTransitionSession(
  session: ExerciseSessionHistory | undefined,
  repLow: number,
  repHigh: number
): boolean {
  const sets = workingSets(session);
  if (sets.length === 0) return false;
  return sets.every((s) => {
    const reps = s.reps ?? 0;
    return reps < repLow - TRANSITION_GUARD_SLACK || reps > repHigh + TRANSITION_GUARD_SLACK;
  });
}

/**
 * Suggest the next working weight for an exercise given its recent history.
 * `history` must be newest-first and contain only completed sessions that
 * logged this exercise. `repLow`/`repHigh` are the rep range actually
 * prescribed for the session(s) in `history` being judged — callers must
 * pass the live prescription, not read it off `exercise` themselves (see
 * docs/DUPLICATION.md: this used to read `exercise.repLow`/`repHigh`
 * directly, which is harmless while the range is static per exercise but
 * becomes a live bug once it varies by training phase).
 */
export function suggestProgression(
  exercise: ExerciseDef,
  history: ExerciseSessionHistory[],
  repLow: number,
  repHigh: number,
  lifterProfile?: LifterProfile | null
): ProgressionSuggestion {
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

  // Phase-transition guard — dormant today (repLow/repHigh are always the
  // exercise's own static range, so a session can never sit "clearly
  // outside" its own range at logging time). Becomes live once callers pass
  // a phase-dependent range: the first session logged under a new target has
  // no evidence for that target yet, so hold rather than let a stale-range
  // session trivially pass allSetsAtTop or trip anySetBelowFloor. Self-heals
  // — the very next session logged against the new range is real evidence
  // and normal progression resumes.
  if (isPhaseTransitionSession(last, repLow, repHigh)) {
    return {
      action: "hold",
      currentWeightKg: current,
      suggestedWeightKg: current,
      reason: "New rep range this phase — hold the weight and find your reps here.",
      atCeiling,
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
    // A session cut short by fatigue holds the load instead of increasing it
    // — the athlete hit the rep target on every set they DID do, but "ran out
    // of gas" is not the same evidence as "had room to spare". This is not a
    // decrease: the pain gate already owns that when there's actual pain.
    if (last.cutShortReason === "fatigue") {
      return {
        action: "hold",
        currentWeightKg: current,
        suggestedWeightKg: current,
        reason: `Held at ${current} kg, you cut last session short from fatigue.`,
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

  // Rule 3 — extra sets are evidence of capacity, not proof of it: only nudge
  // toward an increase when the sets logged BEYOND the prescription also hit
  // the top of the range (an extra set that petered out early says nothing).
  // Never fires on top of Rule 1 above (that's already an increase) or past
  // the ceiling (there's nowhere to go), and a fatigue cut-short still holds
  // — logging extra sets after running out of gas on the prescribed ones
  // isn't the scenario this rule is for, and fatigue's "no increase" reading
  // should win regardless of how that combination could arise.
  const extra = extraSets(last);
  if (extra.length > 0 && extra.every((s) => (s.reps ?? 0) >= repHigh) && !atCeiling) {
    if (last.cutShortReason === "fatigue") {
      return {
        action: "hold",
        currentWeightKg: current,
        suggestedWeightKg: current,
        reason: `Held at ${current} kg, you cut last session short from fatigue.`,
        atCeiling,
      };
    }
    const suggested = current != null ? nextWeight(current) : null;
    return {
      action: "increase",
      currentWeightKg: current,
      suggestedWeightKg: suggested,
      reason: `Logged an extra set at ${repHigh} reps, showing room to add load.`,
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

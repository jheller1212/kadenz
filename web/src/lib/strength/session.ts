import {
  EXERCISE_BY_SLUG,
  SESSION_TEMPLATES,
  hsrPrescriptionForWeek,
  isHsrExercise,
} from "./program";
import { snapToLevel } from "./weights";
import {
  suggestProgression,
  applyPainGate,
  type ProgressionSuggestion,
  type PainGateResult,
} from "./progression";
import type {
  ExerciseDef,
  ExerciseSessionHistory,
  StrengthSessionType,
} from "./types";

// ── Planned session assembly ──────────────────────────────────────────────────
//
// Turns a session type into the concrete list of exercises to perform, merging:
//   • the template (order, sets, rep range, rest)
//   • the HSR week-based calf prescription
//   • per-exercise progression from history (prefill last/suggested weight)
//   • the Achilles pain-gate advisory on calf work

export interface PlannedExercise {
  slug: string;
  name: string;
  category: ExerciseDef["category"];
  equipmentNote?: string;
  tempoNote?: string;
  flatGroundOnly: boolean;
  perSide: boolean;
  /** Dumbbells used (1 or 2); undefined = bodyweight / standard pair. */
  dumbbells?: 1 | 2;
  /** How the load is held, e.g. "opposite hand", "goblet". */
  holdNote?: string;
  sets: number;
  repLow: number;
  repHigh: number;
  restSeconds: number;
  /** Human-readable target, e.g. "3 × 8–12" or the HSR week label. */
  prescription: string;
  suggestedWeightKg: number | null;
  lastWeightKg: number | null;
  /** ISO date of the most recent completed session containing this exercise. */
  lastDate: string | null;
  progression: ProgressionSuggestion;
  painGated: boolean;
}

export interface BuildSessionOptions {
  /** 1-based program week, drives the HSR calf ramp. */
  programWeek?: number;
  /** Per-slug completed-session history, newest-first. */
  historyBySlug?: Record<string, ExerciseSessionHistory[]>;
  /** Result of the Achilles pain gate for this athlete's recent logs. */
  painGate?: PainGateResult;
  /** Strength ability from the weekly-plan wizard; scales sets and rest. */
  ability?: "beginner" | "intermediate" | "advanced";
}

function repRangeLabel(sets: number, low: number, high: number): string {
  return low === high ? `${sets} × ${low}` : `${sets} × ${low}–${high}`;
}

export function buildSessionPlan(
  type: StrengthSessionType,
  opts: BuildSessionOptions = {}
): PlannedExercise[] {
  const template = SESSION_TEMPLATES[type];
  const programWeek = opts.programWeek ?? 1;
  const historyBySlug = opts.historyBySlug ?? {};
  const painGate = opts.painGate ?? { triggered: false, reason: null };
  const ability = opts.ability ?? "intermediate";

  return template.slots.map((slot, slotIdx) => {
    const ex = EXERCISE_BY_SLUG[slot.exerciseSlug];
    const history = historyBySlug[slot.exerciseSlug] ?? [];

    let sets = slot.sets;
    let repLow = slot.repLow;
    let repHigh = slot.repHigh;
    let restSeconds = slot.restSeconds;

    // Ability scaling (HSR rehab work keeps its own scheme, applied below):
    // beginners drop a set and rest longer; advanced athletes add a set to
    // the first two main lifts of the session.
    if (!isHsrExercise(slot.exerciseSlug)) {
      if (ability === "beginner") {
        sets = Math.max(2, sets - 1);
        restSeconds = restSeconds + 30;
      } else if (ability === "advanced" && slotIdx < 2) {
        sets = sets + 1;
      }
    }
    let prescription = repRangeLabel(sets, repLow, repHigh);

    let progression = suggestProgression(ex, history);
    let suggestedWeightKg = progression.suggestedWeightKg;
    const lastWeightKg = progression.currentWeightKg;

    // HSR calf raises follow the explicit week-based scheme.
    if (isHsrExercise(slot.exerciseSlug)) {
      const presc = hsrPrescriptionForWeek(programWeek);
      sets = presc.sets;
      repLow = presc.reps;
      repHigh = presc.reps;
      prescription = presc.label;
      if (history.length === 0) {
        suggestedWeightKg = snapToLevel(presc.weightKg);
      }
    }

    // Pain-gate advisory applies to calf (HSR) work only.
    let painGated = false;
    if (isHsrExercise(slot.exerciseSlug) && painGate.triggered) {
      progression = applyPainGate(progression, painGate);
      suggestedWeightKg = progression.suggestedWeightKg;
      painGated = true;
    }

    return {
      slug: ex.slug,
      name: ex.name,
      category: ex.category,
      equipmentNote: ex.equipmentNote,
      tempoNote: ex.tempoNote,
      flatGroundOnly: ex.flatGroundOnly ?? false,
      perSide: slot.perSide ?? false,
      dumbbells: ex.dumbbells,
      holdNote: ex.holdNote,
      sets,
      repLow,
      repHigh,
      restSeconds,
      prescription,
      suggestedWeightKg,
      lastWeightKg,
      lastDate: history[0]?.date.toISOString() ?? null,
      progression,
      painGated,
    };
  });
}

// ── Achilles ordering rule ────────────────────────────────────────────────────
//
// Hard rule: within an Achilles session, explosive work comes before slow heavy
// (HSR) work. Validates a proposed exercise order.

export function validateAchillesOrdering(orderedSlugs: string[]): {
  valid: boolean;
  message: string | null;
} {
  let lastExplosiveIdx = -1;
  let firstSlowHeavyIdx = -1;
  orderedSlugs.forEach((slug, idx) => {
    const ex = EXERCISE_BY_SLUG[slug];
    if (!ex) return;
    if (ex.achillesRole === "explosive") lastExplosiveIdx = idx;
    if (ex.achillesRole === "slow_heavy" && firstSlowHeavyIdx === -1) {
      firstSlowHeavyIdx = idx;
    }
  });
  if (lastExplosiveIdx === -1 || firstSlowHeavyIdx === -1) {
    return { valid: true, message: null };
  }
  if (lastExplosiveIdx > firstSlowHeavyIdx) {
    return {
      valid: false,
      message: "Explosive work must come before slow heavy (HSR) calf work.",
    };
  }
  return { valid: true, message: null };
}

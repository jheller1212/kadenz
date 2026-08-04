import {
  EXERCISE_BY_SLUG,
  growthCandidatesFor,
  hsrPrescriptionForWeek,
  isHsrExercise,
  resolveSlotVariant,
  RUNNING_FOCUS_POSTERIOR_CHAIN_SLUGS,
  sessionTemplateFor,
} from "./program";
import { complaintWorkSlugs } from "./complaint-work";
import { snapToLevel } from "./weights";
import {
  suggestProgression,
  applyPainGate,
  type ProgressionSuggestion,
  type PainGateResult,
  type PrescribedRepRange,
} from "./progression";
import { estimateWorkoutDuration } from "./estimate";
import { fitSessionToDuration, type DurationFitExercise } from "./duration-fit";
import {
  PHASE_MIN_SETS,
  setsDeltaFor,
  repRangeFor,
  isPhaseIntensityExercise,
  phaseIntensityRepRangeFor,
  type WeekInfo,
} from "./phase-policy";
import type {
  Complaint,
  Equipment,
  ExerciseDef,
  ExerciseSessionHistory,
  Goal,
  StrengthSessionType,
} from "./types";
import type { LifterProfile } from "./load-model";

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
  /** Trim priority for duration-fitting — see duration-fit.ts. */
  priority: "primary" | "accessory" | "achilles" | "targeted";
  /** True only for the week-based HSR calf raises — never duration-trimmed. */
  setsLocked: boolean;
  /** ExerciseDef.primaryMuscle — carried through so duration-fit can balance
   *  newly-added exercises across muscle groups (see pickComplementaryCandidate). */
  primaryMuscle?: string;
}

export interface BuildSessionOptions {
  /** 1-based program week, drives the HSR calf ramp. */
  programWeek?: number;
  /** Per-slug completed-session history, newest-first. */
  historyBySlug?: Record<string, ExerciseSessionHistory[]>;
  /** Result of the Achilles pain gate for this athlete's recent logs. */
  painGate?: PainGateResult;
  /**
   * Per-complaint pain gates (evaluateComplaintPainGates in progression.ts),
   * keyed by every complaint except "achilles" (that one keeps `painGate`
   * above). A triggered entry eases only the exercise(s) that complaint
   * itself added via TARGETED_WORK (see complaint-work.ts complaintWorkSlugs)
   * — a knee complaint never touches a hamstring exercise, and neither
   * touches Achilles/HSR work.
   */
  complaintPainGates?: Partial<Record<Complaint, PainGateResult>>;
  /** Strength ability from the weekly-plan wizard; scales sets and rest. */
  ability?: "beginner" | "intermediate" | "advanced";
  /** Bodyweight/sex/experience for personalised cold-start loads. */
  lifterProfile?: LifterProfile | null;
  /**
   * Reported running complaints (Kraft setup, optional step). "achilles"
   * itself no longer changes what THIS call builds — the dedicated
   * achilles/lower_achilles/upper_achilles types always carry their block
   * regardless of complaints, and a plain type's Achilles/HSR work is decided
   * per session via `achillesAttached` below, not by this list (see
   * reconcile.ts computeAchillesRehabDays). Every other complaint still
   * injects its own small targeted block into the ordinary lower/full_body
   * sessions (see program.ts TARGETED_WORK). Empty/absent = the general
   * runner default (no targeted work).
   */
  complaints?: Complaint[];
  /**
   * Whether the weekly Achilles/HSR rehab pass chose THIS specific session's
   * day as a rehab day and this session already existed as a plain
   * upper/lower/full_body session that day (schema.ts strengthSessions.
   * achillesAttached) — appends the same explosive-then-HSR block the
   * dedicated "achilles" type carries (see program.ts sessionTemplateFor).
   * Has no effect on the dedicated achilles/lower_achilles/upper_achilles
   * types, which always carry it. Default false.
   */
  achillesAttached?: boolean;
  /**
   * The athlete's chosen session length (Kraft settings: 30/45/60 min). When
   * given, the plan is reshaped (see duration-fit.ts) so its estimate
   * actually lands near this budget instead of staying at the template's
   * fixed nominal length regardless of what was chosen.
   */
  targetDurationMinutes?: number;
  /**
   * The athlete's preferred rest between sets (Kraft settings). When set, it
   * overrides every non-rehab exercise's prescribed rest, so the plan matches
   * their rest-timer choice. HSR/Achilles rehab work keeps its own protocol.
   */
  restSecondsOverride?: number | null;
  /**
   * The athlete's available equipment (Kraft setup's equipment step). When
   * given, each slot resolves to the best variant it can actually perform
   * (see program.ts resolveSlotVariant/SQUAT_VARIANTS etc.), and any
   * remaining "accessory" slot whose exercise still doesn't fit is dropped
   * rather than prescribed unusable — the same trim philosophy duration-fit
   * already applies for time. Achilles-role and "primary"/"targeted" slots
   * are never dropped this way; their variant chains always end in a
   * bodyweight ("[]") option, so they always resolve to something.
   * `null`/absent = no equipment info yet — every slot keeps its original
   * base exercise, unfiltered (matches pre-equipment-aware behaviour).
   */
  equipment?: Equipment[] | null;
  /**
   * The running plan's phase/type for the week this session falls in
   * (base/build/peak/taper, normal/deload/race) — drives the set-count
   * backoff in phase-policy.ts. Null/absent = no active running plan (a
   * standalone strength block), which leaves set counts untouched.
   */
  weekInfo?: WeekInfo | null;
  /**
   * Resolves the running plan's week phase/type for an arbitrary PAST date
   * (typically a primary exercise's most recent completed session, i.e.
   * `history[0].date`) — the same shape `weekInfo` carries for THIS
   * session's own date, just queryable for any date. Used only to derive
   * `lastSessionRepRange` for `suggestProgression` below, so PR1's
   * phase-transition guard can hold the weight on the first heavy session
   * of a new phase instead of judging it against a range it wasn't
   * prescribed under. Absent = caller can't resolve it (e.g. no active
   * plan), which leaves the guard inert, matching every call site before
   * this option existed.
   */
  weekInfoForDate?: (date: Date) => WeekInfo | null;
  /**
   * The athlete's strength goal (Kraft setup wizard). "running_focus" trims
   * a set from ordinary upper-body work and adds one to posterior-chain/
   * unilateral lower work (see program.ts RUNNING_FOCUS_POSTERIOR_CHAIN_
   * SLUGS) — never touches HSR/Achilles-role sets, same as ability scaling
   * above. Undefined/"all_round" leaves set counts exactly as prescribed.
   */
  goal?: Goal;
}

function repRangeLabel(sets: number, low: number, high: number): string {
  return low === high ? `${sets} × ${low}` : `${sets} × ${low}–${high}`;
}

export function buildSessionPlan(
  type: StrengthSessionType,
  opts: BuildSessionOptions = {}
): PlannedExercise[] {
  const template = sessionTemplateFor(type, opts.complaints ?? [], opts.achillesAttached ?? false);
  const programWeek = opts.programWeek ?? 1;
  const historyBySlug = opts.historyBySlug ?? {};
  const painGate = opts.painGate ?? { triggered: false, reason: null };
  const ability = opts.ability ?? "intermediate";
  const lifterProfile = opts.lifterProfile ?? null;
  const equipmentAvailable = opts.equipment ?? null;
  const complaintPainGates = opts.complaintPainGates ?? {};

  // Which reported (non-Achilles) complaint, if any, put a given slug into
  // this session — the reverse of complaint-work.ts complaintWorkSlugs, built
  // fresh per session since two athletes' complaint sets differ. First
  // complaint to claim a slug wins; TARGETED_WORK never assigns the same slug
  // to two complaints, so this never actually has to arbitrate.
  const complaintForSlug = new Map<string, Complaint>();
  for (const complaint of opts.complaints ?? []) {
    if (complaint === "achilles") continue;
    for (const slug of complaintWorkSlugs(complaint)) {
      if (!complaintForSlug.has(slug)) complaintForSlug.set(slug, complaint);
    }
  }

  // Slots are resolved in template order, threading `usedSlugs` through so a
  // later slot whose equipment-satisfying variants are all already used by
  // an earlier slot in THIS session (e.g. the hinge and hip-thrust patterns
  // both bottoming out at the bodyweight hip raise with no equipment) picks
  // the next acceptable variant instead of repeating the same exercise — see
  // program.ts resolveSlotVariant. A slot that's genuinely left with nothing
  // new to add (every equipment-satisfying option already used) is dropped
  // rather than prescribed twice, unless it's Achilles-role or "targeted"
  // complaint work — that work is protected and never dropped, so its own
  // variant chain always ends in a fallback distinct from the generic
  // movement-pattern floors (see KNEE_TARGETED_VARIANTS / HAMSTRING_
  // TARGETED_VARIANTS in program.ts) and should never actually collide.
  const usedSlugs = new Set<string>();
  const resolvedSlots: Array<{
    slot: (typeof template.slots)[number];
    slotIdx: number;
    resolved: ReturnType<typeof resolveSlotVariant>;
  }> = [];
  template.slots.forEach((slot, slotIdx) => {
    const resolved = resolveSlotVariant(slot, equipmentAvailable, usedSlugs);
    const ex = EXERCISE_BY_SLUG[resolved.slug];
    const priority: PlannedExercise["priority"] = ex.achillesRole
      ? "achilles"
      : slot.priority ?? "primary";
    if (resolved.duplicate && priority !== "achilles" && priority !== "targeted") {
      return; // nothing new to add — redundant with an earlier slot, drop it
    }
    usedSlugs.add(resolved.slug);
    resolvedSlots.push({ slot, slotIdx, resolved });
  });

  const plan = resolvedSlots.map(({ slot, slotIdx, resolved }) => {
    const ex = EXERCISE_BY_SLUG[resolved.slug];
    const history = historyBySlug[resolved.slug] ?? [];

    let sets = resolved.sets;
    let repLow = resolved.repLow;
    let repHigh = resolved.repHigh;
    let restSeconds = slot.restSeconds;

    // Ability scaling (HSR rehab work keeps its own scheme, applied below):
    // beginners drop a set and rest longer; advanced athletes add a set to
    // the first two main lifts of the session.
    if (!isHsrExercise(resolved.slug)) {
      if (ability === "beginner") {
        sets = Math.max(2, sets - 1);
        restSeconds = restSeconds + 30;
      } else if (ability === "advanced" && slotIdx < 2) {
        sets = sets + 1;
      }
      // The athlete's rest-timer preference wins over the program default (and
      // the beginner +30) for regular lifts — rehab work above keeps its scheme.
      if (opts.restSecondsOverride != null) {
        restSeconds = opts.restSecondsOverride;
      }
      // Running-focus goal: minimal upper-body volume, extra posterior-chain/
      // unilateral work — see program.ts RUNNING_FOCUS_POSTERIOR_CHAIN_SLUGS.
      // Never touches HSR/Achilles-role sets (guarded by the isHsrExercise
      // check above and the !ex.achillesRole check below).
      if (opts.goal === "running_focus" && !ex.achillesRole) {
        if (ex.category === "upper") {
          sets = Math.max(2, sets - 1);
        } else if (RUNNING_FOCUS_POSTERIOR_CHAIN_SLUGS.has(resolved.slug)) {
          sets = sets + 1;
        }
      }
    }

    // Running-plan phase backoff (see phase-policy.ts) — never touches HSR
    // rehab sets (own scheme, applied below) or any Achilles-role exercise
    // (explosive step-up, toe walk): that work is load-bearing rehab, not a
    // training-load knob the running plan gets to turn down.
    if (!isHsrExercise(slot.exerciseSlug) && !ex.achillesRole) {
      sets = Math.max(PHASE_MIN_SETS, sets + setsDeltaFor(opts.weekInfo));
    }

    // Running-plan phase intensity (see phase-policy.ts repRangeFor) — the
    // third lever, narrower than the set backoff above: only a curated set
    // of genuine compound-lift patterns (PHASE_INTENSITY_COMPOUND_SLUGS —
    // squat/hinge/press/row/weighted-pull-up) gets its rep range compressed
    // by phase. Deliberately NOT gated on `slot.priority`: that field is
    // sparse (most slots omit it) and inconsistently tagged — several of
    // these same slugs are explicitly "accessory" in one template and
    // untagged in another, so priority alone would compress the same
    // exercise in one session and leave it alone in another, in the same
    // week. Accessory/targeted work (including a knee/hamstring complaint's
    // own exercises), isometric holds and unloaded bodyweight work all stay
    // on their designed range — compressing e.g. a targeted single-leg
    // exercise, or a wall sit, into a heavy 4-6 scheme it was never
    // programmed for would be quietly wrong, not "the system working". An
    // exercise with no `startWeightKg` can't be progressively loaded at all,
    // so a heavy range would be meaningless for it even if it were ever
    // added to the curated set by mistake — kept as a second, independent
    // guard rather than trusting the set alone. HSR/Achilles-role work is
    // excluded by the same guard as the set backoff, for the same reason
    // (rehab, not a training-load knob).
    let progRepLow = ex.repLow ?? 8;
    let progRepHigh = ex.repHigh ?? 12;
    let lastSessionRepRange: PrescribedRepRange | null = null;
    if (isPhaseIntensityExercise(resolved.slug, ex.startWeightKg, ex.achillesRole)) {
      const phaseRange = repRangeFor(opts.weekInfo);
      if (phaseRange) {
        repLow = phaseRange.repLow;
        repHigh = phaseRange.repHigh;
        progRepLow = phaseRange.repLow;
        progRepHigh = phaseRange.repHigh;
      }
      // The previous session for THIS exercise may have been prescribed
      // under a different phase's range (a real phase transition, not a
      // guess from the reps it logged) — when the caller can resolve that
      // past date's phase, hand it to suggestProgression so its dormant
      // transition guard (see progression.ts) activates exactly there.
      if (opts.weekInfoForDate && history[0]) {
        lastSessionRepRange = repRangeFor(opts.weekInfoForDate(history[0].date));
      }
    }
    let prescription = repRangeLabel(sets, repLow, repHigh);

    let progression = suggestProgression(
      ex,
      history,
      progRepLow,
      progRepHigh,
      lifterProfile,
      lastSessionRepRange
    );
    let suggestedWeightKg = progression.suggestedWeightKg;
    const lastWeightKg = progression.currentWeightKg;

    // HSR calf raises follow the explicit week-based scheme.
    if (isHsrExercise(resolved.slug)) {
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
    if (isHsrExercise(resolved.slug) && painGate.triggered) {
      progression = applyPainGate(progression, painGate);
      suggestedWeightKg = progression.suggestedWeightKg;
      painGated = true;
    }

    // Non-Achilles complaint pain gate: eases only the exercise the reporting
    // complaint itself added (complaintForSlug above), never Achilles/HSR
    // work and never another complaint's exercise. Easing means a real
    // change the athlete can see, not just a capped suggested weight (most
    // targeted work is bodyweight, so that alone would be invisible): drop
    // one set, floored at 2 — the same floor beginner-ability scaling uses.
    const gatingComplaint = complaintForSlug.get(resolved.slug);
    if (gatingComplaint) {
      const complaintGate = complaintPainGates[gatingComplaint];
      if (complaintGate?.triggered) {
        progression = applyPainGate(progression, complaintGate);
        suggestedWeightKg = progression.suggestedWeightKg;
        sets = Math.max(2, sets - 1);
        prescription = repRangeLabel(sets, repLow, repHigh);
        painGated = true;
      }
    }

    // Achilles-role work (both HSR and flexible explosive/toe-walk) is
    // never "accessory" regardless of the template's slot.priority — the
    // tendon program is load-bearing, not optional (see duration-fit.ts).
    const priority: PlannedExercise["priority"] = ex.achillesRole
      ? "achilles"
      : slot.priority ?? "primary";

    return {
      slug: ex.slug,
      name: ex.name,
      category: ex.category,
      equipmentNote: ex.equipmentNote,
      tempoNote: ex.tempoNote,
      flatGroundOnly: ex.flatGroundOnly ?? false,
      perSide: resolved.perSide,
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
      priority,
      setsLocked: isHsrExercise(resolved.slug),
      primaryMuscle: ex.primaryMuscle,
    };
  })
    // A remaining "accessory" slot whose resolved exercise still needs kit
    // this athlete doesn't have (no variant list, or every variant needs
    // more than they have) is dropped rather than prescribed unusable — the
    // same trim the athlete already sees from duration-fit for time, now
    // also applied for equipment. Primary/targeted/achilles slots are never
    // dropped this way; their variant chains always end in a bodyweight
    // option (or, for Achilles, were never equipment-gated to begin with).
    .filter((planned) => {
      if (equipmentAvailable == null || planned.priority !== "accessory") return true;
      const needs = EXERCISE_BY_SLUG[planned.slug]?.equipment ?? [];
      return needs.every((e) => equipmentAvailable.includes(e));
    });

  if (opts.targetDurationMinutes == null) return plan;

  // Extra exercises growth can reach for once the plan is at a sensible
  // working volume but still has budget left (see duration-fit.ts) — already
  // filtered to this session type + this athlete's equipment, and never
  // duplicating an exercise the plan already has.
  const candidates: PlannedExercise[] = growthCandidatesFor(type, equipmentAvailable)
    .filter((ex) => !plan.some((p) => p.slug === ex.slug))
    .map((ex) => {
      const history = historyBySlug[ex.slug] ?? [];
      const sets = ex.defaultSets ?? 3;
      // A growth candidate is a fresh addition to the plan, same as a
      // mid-session "Add exercise" — it must respect the running-plan phase
      // intensity lever exactly like the main plan above (see
      // isPhaseIntensityExercise), not fall back to the exercise's static
      // catalogue range and quietly disagree with the rest of the session.
      const phaseRange = phaseIntensityRepRangeFor(
        ex.slug,
        ex.startWeightKg,
        ex.achillesRole,
        opts.weekInfo
      );
      const repLow = phaseRange?.repLow ?? ex.repLow ?? 8;
      const repHigh = phaseRange?.repHigh ?? ex.repHigh ?? 12;
      const restSeconds = opts.restSecondsOverride ?? 90;
      const progression = suggestProgression(ex, history, repLow, repHigh, lifterProfile);
      return {
        slug: ex.slug,
        name: ex.name,
        category: ex.category,
        equipmentNote: ex.equipmentNote,
        tempoNote: ex.tempoNote,
        flatGroundOnly: ex.flatGroundOnly ?? false,
        perSide: false,
        dumbbells: ex.dumbbells,
        holdNote: ex.holdNote,
        sets,
        repLow,
        repHigh,
        restSeconds,
        prescription: repRangeLabel(sets, repLow, repHigh),
        suggestedWeightKg: progression.suggestedWeightKg,
        lastWeightKg: progression.currentWeightKg,
        lastDate: history[0]?.date.toISOString() ?? null,
        progression,
        painGated: false,
        priority: "accessory",
        setsLocked: false,
        primaryMuscle: ex.primaryMuscle,
      };
    });

  // Reshape the plan so its estimate actually reflects the chosen session
  // length (see duration-fit.ts) — otherwise the setting is stored/displayed
  // but never consumed, and 30/45/60 min all produce the same workout.
  const { exercises: fitted } = fitSessionToDuration(plan, opts.targetDurationMinutes, candidates);
  return fitted.map((ex) => ({
    ...ex,
    // HSR label stays as-is (locked); everything else's label follows sets.
    prescription: ex.setsLocked
      ? ex.prescription
      : repRangeLabel(ex.sets, ex.repLow, ex.repHigh),
  }));
}

/** Estimated real-world duration (minutes) of an already-built session plan. */
export function estimateSessionMinutes(exercises: PlannedExercise[]): number {
  return estimateWorkoutDuration(exercises);
}

// ── Exercise overrides (Exchange / Remove) ────────────────────────────────────
//
// A session's plan is always re-derived from its template at read time (see
// buildPlannedSession above) — there is no stored per-session exercise list.
// Overrides are the hand-edit layer on top: persisted on the session row
// (schema.ts strengthSessions.exerciseOverrides) and re-applied here on every
// read. "removed" drops the slot; "swapped" keeps the original slot's
// sets/reps/rest (same training stimulus) but swaps in a different exercise,
// re-running progression against THAT exercise's own history. Never applies
// to Achilles-role slots — that work is rehab, not filler, and callers must
// reject overrides that target or point at one (see the API route).

export type ExerciseOverride =
  | { /** Slug of the exercise being overridden (as it appears in the template). */ slug: string; action: "removed" }
  | { slug: string; action: "swapped"; replacementSlug: string };

export function applyExerciseOverrides(
  plan: PlannedExercise[],
  overrides: ExerciseOverride[],
  ctx: {
    historyBySlug: Record<string, ExerciseSessionHistory[]>;
    lifterProfile: LifterProfile | null;
  }
): PlannedExercise[] {
  if (!overrides || overrides.length === 0) return plan;
  let result = plan;
  for (const ov of overrides) {
    if (ov.action === "removed") {
      result = result.filter((e) => e.slug !== ov.slug);
      continue;
    }
    if (ov.action === "swapped" && ov.replacementSlug) {
      const idx = result.findIndex((e) => e.slug === ov.slug);
      const ex = EXERCISE_BY_SLUG[ov.replacementSlug];
      if (idx === -1 || !ex || ex.achillesRole) continue;
      const original = result[idx];
      const history = ctx.historyBySlug[ov.replacementSlug] ?? [];
      const progression = suggestProgression(ex, history, ex.repLow ?? 8, ex.repHigh ?? 12, ctx.lifterProfile);
      const replacement: PlannedExercise = {
        slug: ex.slug,
        name: ex.name,
        category: ex.category,
        equipmentNote: ex.equipmentNote,
        tempoNote: ex.tempoNote,
        flatGroundOnly: ex.flatGroundOnly ?? false,
        perSide: original.perSide,
        dumbbells: ex.dumbbells,
        holdNote: ex.holdNote,
        sets: original.sets,
        repLow: original.repLow,
        repHigh: original.repHigh,
        restSeconds: original.restSeconds,
        prescription: repRangeLabel(original.sets, original.repLow, original.repHigh),
        suggestedWeightKg: progression.suggestedWeightKg,
        lastWeightKg: progression.currentWeightKg,
        lastDate: history[0]?.date.toISOString() ?? null,
        progression,
        painGated: false,
        priority: original.priority,
        setsLocked: false,
      };
      result = [...result.slice(0, idx), replacement, ...result.slice(idx + 1)];
    }
  }
  return result;
}

// ── Stored exercise order ─────────────────────────────────────────────────────
//
// The plan is rebuilt from the template on every read, so the athlete's own
// order (drag in the pre-start sheet, or a sort chip) has to be stored and
// re-applied here or it dies with the React state that held it. The stored
// value is a list of slugs on the session row (schema.ts
// strengthSessions.exerciseOrder), written when the session starts.
//
// The two mismatch cases both resolve towards keeping the plan intact:
//   • a stored slug the plan no longer has (removed by an override, trimmed
//     by duration-fit, or added ad hoc in the sheet and never persisted) is
//     ignored;
//   • a plan exercise missing from the stored order is NEW relative to that
//     order, so it goes after the exercises the athlete did place, in plan
//     order. It is never dropped.
//
// This governs the plan before and during a session only. A completed
// session is ordered by when each exercise's first set was actually logged
// (session-order.ts firstLoggedExerciseOrder), because that is the record of
// what happened rather than what was intended.

export function applyExerciseOrder(
  plan: PlannedExercise[],
  order: string[] | null | undefined
): PlannedExercise[] {
  if (!order || order.length === 0) return plan;
  const rank = new Map<string, number>();
  order.forEach((slug, i) => {
    if (!rank.has(slug)) rank.set(slug, i);
  });
  // Stable: equal ranks (two unplaced exercises) keep their plan order.
  return plan
    .map((ex, i) => ({ ex, i, rank: rank.get(ex.slug) ?? Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.i - b.i))
    .map((e) => e.ex);
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

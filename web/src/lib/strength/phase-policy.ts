// ── Strength volume vs. running-plan phase ───────────────────────────────────
//
// Three independent levers pull on strength load as a running plan moves
// through its phases:
//
//   1. How many strength sessions a week carries — reconcile.weekBudgetFor.
//      That's the frequency lever (peak/taper/deload lose one session,
//      floor 1; race week loses all of them).
//   2. How heavy the sessions that DO happen are — this module. That's the
//      volume lever: a per-phase set-count delta applied to every exercise
//      in a session (see session.ts), skipping Achilles-role and HSR work,
//      which is rehab, not a training-load knob.
//   3. How heavy each working set itself is — also this module. The
//      intensity lever: a per-phase rep-range shift (PHASE_REP_POLICY /
//      repRangeFor below), applied in session.ts only to primary compound
//      lifts (not accessory, targeted, HSR or Achilles work — see
//      session.ts buildSessionPlan). Kept as its own table, not folded into
//      PHASE_SET_POLICY, so each lever stays independently reviewable: sets
//      and reps move for different reasons and don't always move together
//      (peak/taper cut sets but hold intensity — see the table below).
//
// A coach should be able to read this table and agree with it:
//
//   base    →  0   normal load, building the aerobic + strength base together
//   build   →  0   normal load — this is the phase strength does its work
//   peak    → -1   back off one set per lift; running mileage is the priority
//   deload  → -1   whatever phase it falls in, a deload week deloads strength too
//   taper   → -2   maintenance only — enough to hold the adaptation, not
//                  enough to cost race-day freshness
//   race    → -3   minimal if a session exists at all (normally none — see
//                  weekBudgetFor, which drops race week to zero sessions)
//
// Applied sets floor at PHASE_MIN_SETS (1) — deliberately lower than
// duration-fit.ts's MIN_SETS (2). Duration-fitting trims for a *readable*
// session shape at a chosen length; a taper or race-week session is meant to
// be genuinely minimal, so it's allowed to go lower.

export type RunPhase = "base" | "build" | "peak" | "taper";

export interface PhaseSetPolicy {
  setsDelta: number;
  note: string;
}

export const PHASE_SET_POLICY: Record<RunPhase, PhaseSetPolicy> = {
  base: { setsDelta: 0, note: "Normal load — building the base." },
  build: { setsDelta: 0, note: "Normal load — this is the phase that does the work." },
  peak: { setsDelta: -1, note: "Back off one set per lift — running mileage is the priority." },
  taper: { setsDelta: -2, note: "Maintenance only — hold the adaptation, don't cost freshness." },
};

export const DELOAD_SET_DELTA = -1;
export const RACE_WEEK_SET_DELTA = -3;

/** Sets never drop below this when a phase backoff is applied — see the note above. */
export const PHASE_MIN_SETS = 1;

export interface PhaseRepRange {
  repLow: number;
  repHigh: number;
}

/**
 * Intensity lever (see header, item 3). Base keeps the standard hypertrophy
 * range; build compresses to a maximal-strength rep range for the phase
 * that's actually meant to build strength. Peak and taper deliberately keep
 * BUILD's range rather than reverting toward base — cutting intensity in
 * those phases would lose the adaptation build just paid for; PHASE_SET_
 * POLICY above is what sheds fatigue instead (peak -1, taper -2 sets), so
 * the two knobs stay orthogonal on the same phase.
 */
export const PHASE_REP_POLICY: Record<RunPhase, PhaseRepRange> = {
  base: { repLow: 8, repHigh: 12 },
  build: { repLow: 4, repHigh: 6 },
  peak: { repLow: 4, repHigh: 6 },
  taper: { repLow: 4, repHigh: 6 },
};

/**
 * Rep range for the week a session falls in, or null with no active running
 * plan / an unrecognised phase (standalone block — same "no phase concept"
 * case setsDeltaFor/phaseSummaryFor return early on).
 *
 * Unlike setsDeltaFor, week `type` (deload/race) is NOT read here and never
 * overrides this: a deload or race week keeps whatever phase's rep range it
 * sits inside and only cuts sets — setsDeltaFor already handles that half.
 * Splitting sets and reps into two functions (rather than one that reads
 * both phase and type) is what keeps that asymmetry visible instead of
 * baking it into a shared branch that's easy to edit for one and forget the
 * other.
 */
export function repRangeFor(weekInfo: WeekInfo | null | undefined): PhaseRepRange | null {
  if (!weekInfo) return null;
  const policy = PHASE_REP_POLICY[weekInfo.phase as RunPhase];
  return policy ? { repLow: policy.repLow, repHigh: policy.repHigh } : null;
}

/** Same note vocabulary as PHASE_SET_POLICY, for the two week `type`s that
 *  override phase (deload/race) rather than reading it — see setsDeltaFor. */
const TYPE_NOTE: Record<"deload" | "race", string> = {
  deload: "Whatever phase it falls in, a deload week deloads strength too.",
  race: "Minimal, if a session exists at all — race week is about the race.",
};

const PHASE_LABEL: Record<RunPhase, string> = {
  base: "Base",
  build: "Build",
  peak: "Peak",
  taper: "Taper",
};

export interface PhaseSummary {
  /** What the running plan's week.phase actually is, regardless of type override. */
  phase: RunPhase | null;
  /** Human label for that phase — "Base", "Build", "Peak", "Taper". */
  phaseLabel: string;
  /** One line: what this phase means for today's strength session, in the
   *  same reason vocabulary as PHASE_SET_POLICY (and TYPE_NOTE for the
   *  deload/race overrides — see setsDeltaFor for why type wins over phase). */
  note: string;
}

/**
 * One-line summary of the running phase strength is following, for surfacing
 * on the Kraft hub / session overview — same inputs and same type-wins-over-
 * phase precedence as setsDeltaFor, just returning the reason text instead of
 * the numeric delta. Null with no active running plan (standalone block has
 * no phase to report).
 */
export function phaseSummaryFor(weekInfo: WeekInfo | null | undefined): PhaseSummary | null {
  if (!weekInfo) return null;
  const phase = (PHASE_SET_POLICY[weekInfo.phase as RunPhase] ? weekInfo.phase : null) as RunPhase | null;
  const phaseLabel = phase ? PHASE_LABEL[phase] : weekInfo.phase;
  if (weekInfo.type === "race") return { phase, phaseLabel, note: TYPE_NOTE.race };
  if (weekInfo.type === "deload") return { phase, phaseLabel, note: TYPE_NOTE.deload };
  const policy = phase ? PHASE_SET_POLICY[phase] : null;
  return { phase, phaseLabel, note: policy ? policy.note : "Normal load." };
}

/** Minimal week-info shape this module needs — matches `weeks.phase` / `weeks.type`. */
export interface WeekInfo {
  phase: string;
  type: string;
}

/**
 * Set-count delta for the week a session falls in, or 0 with no running plan
 * (a standalone strength block has no phase concept and keeps its own
 * unmodified progression — see schedule.ts's `block` branch).
 *
 * `type` wins over `phase`: a deload or race week deloads regardless of which
 * base/build/peak phase it sits inside.
 */
export function setsDeltaFor(weekInfo: WeekInfo | null | undefined): number {
  if (!weekInfo) return 0;
  if (weekInfo.type === "race") return RACE_WEEK_SET_DELTA;
  if (weekInfo.type === "deload") return DELOAD_SET_DELTA;
  const policy = PHASE_SET_POLICY[weekInfo.phase as RunPhase];
  return policy ? policy.setsDelta : 0;
}

// ── Strength volume vs. running-plan phase ───────────────────────────────────
//
// Two independent levers pull on strength load as a running plan moves
// through its phases:
//
//   1. How many strength sessions a week carries — reconcile.weekBudgetFor.
//      That's the frequency lever (peak/taper/deload lose one session,
//      floor 1; race week loses all of them).
//   2. How heavy the sessions that DO happen are — this module. That's the
//      volume lever: a per-phase set-count delta applied to every exercise
//      in a session (see session.ts), skipping Achilles-role and HSR work,
//      which is rehab, not a training-load knob.
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

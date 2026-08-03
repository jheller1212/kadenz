// Shared presentation helpers for the Plan hub pages (/plan, /plan/overview,
// /plan/manage). Colors come from the single source of truth in
// workout-colors.ts (same palette as --k-type-* in globals.css) — this used
// to keep its own duplicate hex palette that had drifted from the rest of
// the app (Today's easy runs were bright green, Plan's were olive), so
// spines and CalendarStrip dots disagreed on what "easy" looks like.

import type { WorkoutType } from "@/lib/plan-engine/types";
import { WORKOUT_COLORS, STRENGTH_COLOR, strengthSessionLabel } from "@/lib/workout-colors";
import { isCompletedSession, isPastDuePlanned, type SessionStatus } from "@/lib/training/session";
import { displayWorkoutTitle } from "@/lib/plan-engine/workout-title";
import { displayDistance, distanceUnitLabel } from "@/lib/units";

export const STRENGTH_BLUE = STRENGTH_COLOR.solid;

/** Darken a #RRGGBB hex color by `amount` (0–1). */
export function darken(hex: string, amount = 0.2): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 0xff) * (1 - amount));
  const g = Math.round(((n >> 8) & 0xff) * (1 - amount));
  const b = Math.round((n & 0xff) * (1 - amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Vertical gradient spine for run cards — the canonical type gradient. */
export function runSpine(type: WorkoutType): string {
  return WORKOUT_COLORS[type]?.grad ?? "linear-gradient(135deg, #A8B3C1, #7C8794)";
}

export const STRENGTH_SPINE = STRENGTH_COLOR.grad;

// ── Lean API row types (subset of the DB rows the routes return) ─────────────

export interface ApiWorkoutRow {
  id: string;
  date: string;
  type: WorkoutType;
  title: string;
  status: string;
  targetKm: number | null;
  targetDurationMinutes: number | null;
  actualKm?: number | null;
  // Present when the API query included blocks (the plan detail route
  // always does) — displayWorkoutTitle() needs the "work" block to derive a
  // tempo title's number; falls back to the stored title without it.
  blocks?: Array<{ type: string; distanceKm?: number | null }> | null;
}

export interface ApiWeekRow {
  id: string;
  weekNumber: number;
  phase?: "base" | "build" | "peak" | "taper";
  targetKm: number;
  workouts: ApiWorkoutRow[];
  /** Set once the athlete drops this week — see /plan/manage's "Skip a week". */
  skippedAt?: string | null;
  skipReason?: string | null;
}

export interface ApiPlanRow {
  id: string;
  name: string;
  intent?: "race" | "get_fit" | "maintain";
  raceDistance: "5k" | "10k" | "half" | "marathon";
  goalTimeSeconds: number;
  vdot: number | null;
  startDate: string;
  raceDate: string;
  planLengthWeeks: number;
  daysPerWeek: number;
  preferredLongRunDay: number | null;
  availableDays?: number[] | null;
  weeks: ApiWeekRow[];
}

export interface StrengthSessionRow {
  id: string;
  date: string;
  type: string;
  title: string;
  status: string;
  targetDurationMinutes: number | null;
  // Whether the weekly rehab pass attached the Achilles/HSR block to THIS
  // session (strength_sessions.achilles_attached) — absent on older/unrelated
  // API responses, treated as false until present.
  achillesAttached?: boolean;
}

// ── Date helpers (weeks start Monday in Kadenz) ───────────────────────────────

export function mondayOf(d: Date): Date {
  const x = new Date(d);
  const dow = x.getDay(); // 0=Sun
  x.setDate(x.getDate() + (dow === 0 ? -6 : 1 - dow));
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "13 JUL - 19 JUL" style eyebrow for a week starting at `monday`. */
export function weekRangeLabel(monday: Date): string {
  const fmt = (d: Date) =>
    d
      .toLocaleDateString("en-US", { day: "numeric", month: "short" })
      .toUpperCase();
  return `${fmt(monday)} - ${fmt(addDays(monday, 6))}`;
}

// ── Phase pips ─────────────────────────────────────────────────────────────
// Every week already carries its training phase (base/build/peak/taper —
// see plan-engine/plan-generator.ts buildPhaseMap and week-skip.ts, which
// both key off it). This distills that per-week data into the block
// structure the aurora header shows: one pip per phase actually present in
// the plan, plus a one-line "peak week in N / taper after" summary.

export type WeekPhase = "base" | "build" | "peak" | "taper";

export interface PhasePip {
  phase: WeekPhase;
  /** "current" = the phase the active week sits in (or the closest one for
   * plans without a resolved current week); "done" = fully behind us;
   * "next" = the phase immediately after current; "later" = further out. */
  state: "done" | "current" | "next" | "later";
}

export interface PhaseSummary {
  pips: PhasePip[];
  /** e.g. "Peak week in 3 · taper after", "Peak week · taper next",
   * "Taper week", or null when the plan has no phase data at all. */
  line: string | null;
}

/**
 * Reduce a plan's per-week phases into the ordered block sequence (base,
 * build, peak, taper — only the phases the plan actually uses, short plans
 * may compress base to nothing) and locate the active block relative to
 * `currentWeekNumber`.
 */
export function phaseSummary(
  weeks: ApiWeekRow[],
  currentWeekNumber: number | null
): PhaseSummary {
  const known = weeks.filter(
    (w): w is ApiWeekRow & { phase: WeekPhase } => w.phase != null
  );
  if (known.length === 0) return { pips: [], line: null };

  // Ordered, de-duplicated list of phase blocks as they occur in the plan.
  const order: WeekPhase[] = [];
  for (const w of known) {
    if (order[order.length - 1] !== w.phase) order.push(w.phase);
  }

  const activeWeek =
    known.find((w) => w.weekNumber === currentWeekNumber) ?? known[0];
  const activeIndex = order.indexOf(activeWeek.phase);

  const pips: PhasePip[] = order.map((phase, i) => ({
    phase,
    state:
      i < activeIndex ? "done" : i === activeIndex ? "current" : i === activeIndex + 1 ? "next" : "later",
  }));

  // Peak/taper are the moments worth calling out; base/build progress is
  // already visible from the pips themselves.
  const hasTaper = order.includes("taper");
  let line: string | null = null;
  if (activeWeek.phase === "peak") {
    line = hasTaper ? "Peak week · taper next" : "Peak week";
  } else if (activeWeek.phase === "taper") {
    line = "Taper week";
  } else {
    const nextPeak = known.find(
      (w) => w.phase === "peak" && w.weekNumber > activeWeek.weekNumber
    );
    if (nextPeak) {
      const weeksAway = nextPeak.weekNumber - activeWeek.weekNumber;
      line = hasTaper
        ? `Peak week in ${weeksAway} · taper after`
        : `Peak week in ${weeksAway}`;
    }
  }

  return { pips, line };
}

/** "25m - 35m" duration window around a strength session's target. */
export function durationWindow(minutes: number): string {
  return `${Math.max(minutes - 5, 5)}m - ${minutes + 5}m`;
}

// ── Item status vocabulary ────────────────────────────────────────────────
// A run workout and a strength session share the same status enum under the
// hood (see lib/training/session.ts) — this reuses that single source of
// truth rather than re-deriving completed/past-due rules here, so a
// cancelled ("skipped", from Manage Plan's "Skip a week") or simply
// past-due-and-never-done ("missed") item never renders identically to an
// ordinary still-open one.

export type ItemState = "completed" | "skipped" | "missed" | "planned";

type DaySpecItem =
  | { kind: "run"; workout: ApiWorkoutRow }
  | { kind: "strength"; session: StrengthSessionRow };

function specStatus(item: DaySpecItem): { status: SessionStatus; date: string } {
  return item.kind === "strength"
    ? { status: item.session.status as SessionStatus, date: item.session.date }
    : { status: item.workout.status as SessionStatus, date: item.workout.date };
}

export function itemState(item: DaySpecItem, now: Date = new Date()): ItemState {
  const { status, date } = specStatus(item);
  if (isCompletedSession({ status })) return "completed";
  if (status === "skipped") return "skipped";
  if (status === "missed") return "missed";
  if (isPastDuePlanned({ status, date }, now)) return "missed";
  return "planned";
}

/** One-line spec for a run or strength item: "Easy Run · 10km". Skipped and
 * missed items get an explicit suffix — the title/distance alone reads
 * identically to a still-open planned item otherwise. */
export function itemSpec(item: DaySpecItem, state?: ItemState): string {
  const base = (() => {
    if (item.kind === "strength") {
      const label = strengthSessionLabel(item.session);
      const d = item.session.targetDurationMinutes;
      return d ? `${label} · ${durationWindow(d)}` : label;
    }
    const w = item.workout;
    const title = displayWorkoutTitle(w);
    // Was `· ${w.targetKm}km` — hardcoded km regardless of the unit setting,
    // same bug as the title itself. Route both through the same conversion.
    if (w.targetKm != null) return `${title} · ${displayDistance(w.targetKm)} ${distanceUnitLabel()}`;
    if (w.targetDurationMinutes != null) return `${title} · ${w.targetDurationMinutes}m`;
    return title;
  })();
  const resolved = state ?? itemState(item);
  if (resolved === "skipped") return `${base} · Skipped`;
  if (resolved === "missed") return `${base} · Missed`;
  return base;
}

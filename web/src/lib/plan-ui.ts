// Shared presentation helpers for the Plan hub pages (/plan, /plan/overview,
// /plan/manage). Colors come from the single source of truth in
// workout-colors.ts (same palette as --k-type-* in globals.css) — this used
// to keep its own duplicate hex palette that had drifted from the rest of
// the app (Today's easy runs were bright green, Plan's were olive), so
// spines and CalendarStrip dots disagreed on what "easy" looks like.

import type { WorkoutType } from "@/lib/plan-engine/types";
import { WORKOUT_COLORS, STRENGTH_COLOR } from "@/lib/workout-colors";

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

/** "25m - 35m" duration window around a strength session's target. */
export function durationWindow(minutes: number): string {
  return `${Math.max(minutes - 5, 5)}m - ${minutes + 5}m`;
}

/** One-line spec for a run or strength item: "Easy Run · 10km". */
export function itemSpec(item:
  | { kind: "run"; workout: ApiWorkoutRow }
  | { kind: "strength"; session: StrengthSessionRow }
): string {
  if (item.kind === "strength") {
    const d = item.session.targetDurationMinutes;
    return d ? `${item.session.title} · ${durationWindow(d)}` : item.session.title;
  }
  const w = item.workout;
  if (w.targetKm != null) return `${w.title} · ${w.targetKm}km`;
  if (w.targetDurationMinutes != null) return `${w.title} · ${w.targetDurationMinutes}m`;
  return w.title;
}

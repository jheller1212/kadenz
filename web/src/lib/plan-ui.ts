// Shared presentation helpers for the Plan hub pages (/plan, /plan/overview,
// /plan/manage). Colors mirror the rearrange calendar's type palette; strength
// is uniformly blue, regardless of session type.

import type { WorkoutType } from "@/lib/plan-engine/types";

export const WORKOUT_BAR_COLOR: Record<WorkoutType, string> = {
  easy:     "#7BC232",
  recovery: "#7BC232",
  long:     "#8655F0",
  tempo:    "#F2A113",
  interval: "#E0402E",
  race:     "#FF4D4D",
  rest:     "#2A2A2E",
};

export const STRENGTH_BLUE = "#3B82F6";

/** Darken a #RRGGBB hex color by `amount` (0–1). */
export function darken(hex: string, amount = 0.2): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 0xff) * (1 - amount));
  const g = Math.round(((n >> 8) & 0xff) * (1 - amount));
  const b = Math.round((n & 0xff) * (1 - amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Vertical gradient spine for run cards (type color → 20% darker). */
export function runSpine(type: WorkoutType): string {
  const c = WORKOUT_BAR_COLOR[type] ?? "#94A3B8";
  return `linear-gradient(180deg, ${c}, ${darken(c)})`;
}

export const STRENGTH_SPINE = "linear-gradient(135deg, #60A5FA 0%, #2563EB 100%)";

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
  weekNumber: number;
  targetKm: number;
  workouts: ApiWorkoutRow[];
}

export interface ApiPlanRow {
  id: string;
  name: string;
  raceDistance: "5k" | "10k" | "half" | "marathon";
  goalTimeSeconds: number;
  vdot: number | null;
  startDate: string;
  raceDate: string;
  planLengthWeeks: number;
  daysPerWeek: number;
  preferredLongRunDay: number | null;
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

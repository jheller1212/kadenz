import {
  placeStrengthWeek,
  type Placement,
  type PlacementDay,
} from "./schedule-place";
import type { StrengthSessionType } from "./types";

// ── Reconcile invariants (pure, unit-tested) ─────────────────────────────────
// The scheduler's contract, extracted so the DB routes stay thin:
//   • prune only future, still-planned sessions the scheduler created and the
//     user never meaningfully edited;
//   • never place a second session on a day that already holds one;
//   • never exceed sessionsPerWeek per calendar week, counting ALL existing
//     sessions that week (completed, manual, past days included).

/** Noon-UTC timestamp for a calendar-day key — DST/TZ-safe day arithmetic. */
export function dateFromDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

/** Monday day-key of the calendar week a day belongs to (weeks cut Monday). */
export function weekKeyOf(dayKey: string): string {
  const d = dateFromDayKey(dayKey);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * A session the reconcile prune may delete: created by the scheduler, never
 * hand-edited, still just "planned", and not in the past. Completed sessions
 * and anything the user touched are permanent.
 */
export function isPrunable(
  s: { date: Date; status: string; autoScheduled: boolean },
  today: Date
): boolean {
  return s.autoScheduled && s.status === "planned" && s.date.getTime() >= today.getTime();
}

/**
 * Whether a sessions PATCH counts as a user-meaningful edit that adopts an
 * auto-scheduled session. Bare status changes (tick / untick / skip) do NOT —
 * otherwise completing-and-unticking launders auto sessions into "hand-made"
 * ones that pruning can never clean up.
 */
export function clearsAutoScheduled(updates: Record<string, unknown>): boolean {
  return Object.keys(updates).some((k) => k !== "status");
}

/**
 * Plan the top-up for a day strip (tomorrow → horizon, calendar order).
 * `sessionsByWeek` maps Monday week-keys to the number of existing sessions in
 * that calendar week — any status, any origin, including days before the strip
 * (earlier this week) — so a week never exceeds the rotation's length. Per-day
 * blocking rides on each day's `taken` flag via the placement engine.
 */
/**
 * Per-week cap on NEW sessions, keyed by Monday. Lets the caller thin out
 * training weeks that shouldn't carry a full strength load — a deload or the
 * race week itself — without teaching this planner about plans.
 */
export type WeekBudget = (weekKey: string, rotationLength: number) => number;

export function computeTopUpPlacements(
  strip: PlacementDay[],
  rotation: StrengthSessionType[],
  availableDays: number[],
  sessionsByWeek: Map<string, number>,
  weekBudget?: WeekBudget
): Placement[] {
  const placements: Placement[] = [];
  let week: PlacementDay[] = [];
  let weekKey = "";

  const flush = () => {
    if (week.length === 0) return;
    const already = sessionsByWeek.get(weekKey) ?? 0;
    const budget = weekBudget ? weekBudget(weekKey, rotation.length) : rotation.length;
    const allowed = Math.max(0, Math.min(budget, rotation.length) - already);
    const remaining = rotation.slice(Math.min(already, rotation.length)).slice(0, allowed);
    if (remaining.length > 0) {
      placements.push(...placeStrengthWeek(week, availableDays, remaining));
    }
    week = [];
  };

  for (const day of strip) {
    const k = weekKeyOf(day.key);
    if (k !== weekKey) {
      flush();
      weekKey = k;
    }
    week.push(day);
  }
  flush();
  return placements;
}

/**
 * How many strength sessions a week should carry, given where it sits in the
 * running plan. Strength supports the running, so it yields when running load
 * peaks and disappears when it matters least to add fatigue.
 *
 *   base / build → full rotation (strength is the point of these weeks)
 *   peak         → one fewer (running mileage is at its highest)
 *   taper        → one fewer, floor 1 (keep the movement pattern, drop volume)
 *   deload       → one fewer, floor 1
 *   race week    → none
 */
export function weekBudgetFor(
  info: { type: string; phase: string } | undefined,
  rotationLength: number
): number {
  if (!info) return rotationLength;
  if (info.type === "race") return 0;
  if (info.type === "deload" || info.phase === "taper" || info.phase === "peak") {
    return Math.max(1, rotationLength - 1);
  }
  return rotationLength;
}

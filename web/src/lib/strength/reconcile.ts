import {
  placeStrengthWeek,
  type Placement,
  type PlacementDay,
} from "./schedule-place";
import type { Complaint, StrengthSessionType } from "./types";

// ── Session-type rotation ─────────────────────────────────────────────────────
// Per goal and sessions/week. Running focus keeps upper body minimal;
// all-round mixes upper and lower evenly.
//
// The dedicated Achilles/HSR session TYPES (achilles, lower_achilles,
// upper_achilles) are no longer scheduled going forward — an "achilles"
// complaint now reshapes an ordinary lower/upper/full_body session instead
// (see program.ts ACHILLES_COMPLAINT_SLOTS / sessionTemplateFor), the same
// way every other reported complaint (plantar fascia, shin, knee, ITB,
// hamstring, hip/glute) already added targeted work without needing its own
// session type. The old types stay valid StrengthSessionType values purely
// so historic sessions of those types still load (see types.ts
// STRENGTH_SESSION_TYPES) — this rotation table just never produces them.
const ROTATIONS: Record<string, Record<number, StrengthSessionType[]>> = {
  running_focus: {
    1: ["lower"],
    2: ["lower", "full_body"],
    3: ["lower", "full_body", "lower"],
    4: ["lower", "full_body", "lower", "upper"],
  },
  all_round: {
    1: ["full_body"],
    2: ["upper", "lower"],
    3: ["upper", "lower", "full_body"],
    4: ["upper", "lower", "full_body", "upper"],
  },
};

/**
 * Session-type rotation for a goal/frequency. `complaints` is accepted for
 * backward compatibility with existing callers but no longer changes which
 * types are scheduled — every complaint, "achilles" included, now reshapes
 * whichever plain type lands on the day (see program.ts sessionTemplateFor)
 * instead of swapping in a dedicated session type.
 */
export function rotationFor(
  goal: string,
  sessionsPerWeek: number,
  _complaints: Complaint[]
): StrengthSessionType[] {
  return ROTATIONS[goal]?.[sessionsPerWeek] ?? ROTATIONS.running_focus[2];
}

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
 * hand-edited, still just "planned", not in the past, and carrying no logged
 * sets or pain check-ins. `hasLoggedData` is supplied by the caller (a DB
 * lookup) rather than queried here, so this stays a pure, DB-free predicate —
 * but it's load-bearing: a session an athlete has started logging looks
 * identical to an untouched one on every other field (logging a set doesn't
 * flip status, and clearing autoScheduled on first log is a belt-and-braces
 * second line of defence, not something this predicate may assume). Completed
 * sessions and anything the user hand-touched are permanent regardless.
 */
export function isPrunable(
  s: { date: Date; status: string; autoScheduled: boolean; hasLoggedData: boolean },
  today: Date
): boolean {
  return (
    s.autoScheduled &&
    s.status === "planned" &&
    !s.hasLoggedData &&
    s.date.getTime() >= today.getTime()
  );
}

/**
 * When completing a session absorbs a same-day planned "twin" of the same
 * type (see PATCH /api/strength/sessions/[id]), the twin's sets and pain
 * logs move onto the completed session, but the twin row itself is never
 * hard-deleted. It's marked skipped instead: that drops it out of "planned"
 * everywhere (no phantom leftover inflating week counts, same as the old
 * delete), but the row survives so a note, a linked Strava/Garmin activity,
 * or a hand-edited exercise list still sitting on it doesn't silently
 * disappear without trace.
 */
export function twinAbsorptionUpdate(now: Date): { status: "skipped"; updatedAt: Date } {
  return { status: "skipped", updatedAt: now };
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

import {
  placeStrengthWeek,
  type Placement,
  type PlacementDay,
} from "./schedule-place";
import type { Complaint, StrengthSessionType } from "./types";

// ── Session-type rotation, derived from frequency + goal ─────────────────────
// Not a hand-typed lookup table: the actual rule this needs to satisfy is
// "no two scheduled sessions in a row share a muscle-group emphasis" (the
// ~48h-per-group recovery window), same as any upper/lower or push-pull-legs
// split. rotationForEmphasis below builds each frequency's sequence from
// that rule directly, so adding a 5th or 6th day never needs a new
// hand-written row.
//
// The dedicated Achilles/HSR session TYPES (achilles, lower_achilles,
// upper_achilles) are no longer scheduled going forward — an "achilles"
// complaint now reshapes an ordinary lower/upper/full_body session instead
// (see program.ts ACHILLES_COMPLAINT_SLOTS / sessionTemplateFor), the same
// way every other reported complaint (plantar fascia, shin, knee, ITB,
// hamstring, hip/glute) already added targeted work without needing its own
// session type. The old types stay valid StrengthSessionType values purely
// so historic sessions of those types still load (see types.ts
// STRENGTH_SESSION_TYPES) — this rotation just never produces them.
//
// The placement engine (schedule-place.ts) does the actual day-by-day work —
// reading the real week's run schedule, hard vetoes, and muscle-group
// overlap on the resolved (complaint-inclusive) exercise list — so this only
// has to decide *how many of each emphasis* the week gets, not which
// calendar day each lands on.
export type Emphasis = "lower" | "upper" | "full";

const EMPHASIS_TYPE: Record<Emphasis, StrengthSessionType> = {
  lower: "lower",
  upper: "upper",
  full: "full_body",
};

/**
 * The week's emphasis sequence for a frequency/goal, satisfying "never the
 * same emphasis twice in a row":
 *   1 → lower alone for a runner (the highest-transfer single session);
 *       full_body alone otherwise (touches everything in one session).
 *   2 → lower/upper.
 *   3 → lower/upper/lower for runners (extra leg exposure); upper/lower/full
 *       for a balanced goal.
 *   4 → strictly alternating lower/upper (never doubles up a group, so it
 *       fits a 5-day weekday week without a spacing conflict) — runners get
 *       a posterior-chain-biased variant (lower/upper/lower/full) instead of
 *       a second upper day.
 *   5-6 → keep alternating and add a second lower (runners) or a full day
 *       (balanced) rather than ever repeating an emphasis back-to-back — six
 *       days a week is a legitimate split, not a scheduling edge case.
 */
export function rotationForEmphasis(goal: string, sessionsPerWeek: number): Emphasis[] {
  const runningFocus = goal === "running_focus";
  const n = Math.max(0, Math.min(6, Math.round(sessionsPerWeek)));
  if (n === 0) return [];
  if (n === 1) return runningFocus ? ["lower"] : ["full"];
  if (n === 2) return ["lower", "upper"];
  if (n === 3) return runningFocus ? ["lower", "upper", "lower"] : ["upper", "lower", "full"];
  const pattern: Emphasis[] = runningFocus
    ? ["lower", "upper", "lower", "full", "lower", "upper"]
    : ["lower", "upper", "lower", "upper", "full", "lower"];
  return pattern.slice(0, n);
}

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
  const emphases = rotationForEmphasis(goal, sessionsPerWeek);
  if (emphases.length === 0) return rotationForEmphasis("running_focus", 2).map((e) => EMPHASIS_TYPE[e]);
  return emphases.map((e) => EMPHASIS_TYPE[e]);
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
 * A stale ad-hoc session: a Kraft-picker "Start" or custom-workout
 * quick-start (never watchEligible — see schema.ts) whose day has fully
 * passed with nothing ever logged against it and no completion/skip. These
 * are throwaway trial sessions, not training history — unlike a missed PLAN
 * day (autoScheduled or deliberately added via Plan > Rearrange), which
 * stays forever so adherence views can show it as "missed". Deliberately
 * restricted to STRICTLY past days (never today) so a session someone is
 * mid-workout on, or means to finish later today, is never swept.
 */
export function isStaleAdhoc(
  s: { date: Date; status: string; watchEligible: boolean; hasLoggedData: boolean },
  today: Date
): boolean {
  return (
    !s.watchEligible &&
    s.status === "planned" &&
    !s.hasLoggedData &&
    s.date.getTime() < today.getTime()
  );
}

// Idle threshold before an in-progress session auto-closes. Chosen to sit
// comfortably above two legitimate reasons a session goes quiet mid-workout:
// a heavy compound lift's rest between working sets (rarely more than 4-5
// minutes even at the top of a strength block) and a genuine pause — a phone
// call, someone else needing the gym equipment — which can run 10-20 minutes
// without the session actually being abandoned. 30 minutes clears both with
// real margin while still closing a truly abandoned session the same day
// rather than leaving it open indefinitely (which is the bug this whole
// feature exists to fix — see getExerciseHistoryBySlug).
export const AUTO_CLOSE_IDLE_MINUTES = 30;

/**
 * A session eligible for auto-close: still "planned" (never explicitly
 * finished or discarded), has real logged-set timestamps (startedAt/endedAt
 * — see schema.ts strengthSessions), and its last logged set is older than
 * the idle threshold. Pure so the boundary is unit-testable without a clock
 * or a database.
 */
export function isAutoCloseDue(
  s: { status: string; startedAt: Date | null; endedAt: Date | null },
  now: Date,
  idleMinutes = AUTO_CLOSE_IDLE_MINUTES
): boolean {
  if (s.status !== "planned" || !s.startedAt || !s.endedAt) return false;
  return now.getTime() - s.endedAt.getTime() >= idleMinutes * 60_000;
}

/**
 * The update an auto-close applies. Status lands on "completed" — not a
 * separate "auto_completed" status — because getExerciseHistoryBySlug and
 * every progression/prefill read filter on status = "completed"; a session
 * with real logged sets that never reaches that status is exactly the data
 * loss this feature exists to close (see the service.ts comment). Duration
 * is the true gap between the first and last logged set, matching what the
 * sessions PATCH route now derives when an athlete finishes in-app.
 */
export function autoCloseUpdate(
  s: { startedAt: Date; endedAt: Date },
  now: Date
): { status: "completed"; durationMinutes: number; updatedAt: Date } {
  return {
    status: "completed",
    durationMinutes: Math.max(1, Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 60_000)),
    updatedAt: now,
  };
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
  weekBudget?: WeekBudget,
  complaints: Complaint[] = []
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
      placements.push(...placeStrengthWeek(week, availableDays, remaining, complaints));
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

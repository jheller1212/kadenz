// "Skip a week" business rules: which weeks an athlete is allowed to drop
// after illness/travel/injury, and which one the app suggests by default.
//
// Deliberately does NOT touch dates or week numbers anywhere — see the
// comment on weeks.skippedAt in db/schema.ts. Dropping a week just cancels
// its not-yet-done workouts in place; the calendar and every other week's
// date stay exactly where they were, so the race day never moves and every
// other consumer of weekNumber (strength phase lookup, Garmin labels, plan
// pages) keeps working unmodified.

import type { WeekPhase } from "./types";

// Phases a week may be dropped from. A coach never sacrifices a peak week or
// eats into the taper/race week — those are excluded on purpose.
const SKIPPABLE_PHASES: readonly WeekPhase[] = ["base", "build"];

export interface SkipCandidateWorkout {
  id: string;
  date: Date;
  status: string;
  gcalEventId?: string | null;
  garminWorkoutId?: string | null;
}

export interface SkipCandidateWeek {
  id: string;
  weekNumber: number;
  phase: WeekPhase;
  skippedAt: Date | null;
  workouts: SkipCandidateWorkout[];
}

export interface WeekEligibility {
  weekId: string;
  weekNumber: number;
  phase: WeekPhase;
  startDate: Date;
  endDate: Date;
  /** True when at least one workout in the week is already done — the week
   * can still be dropped (its remaining, not-yet-done workouts get cancelled),
   * but the UI should say so plainly. */
  hasCompletedWorkouts: boolean;
}

function weekDateRange(week: SkipCandidateWeek): { start: Date; end: Date } | null {
  if (week.workouts.length === 0) return null;
  const times = week.workouts.map((w) => w.date.getTime());
  return { start: new Date(Math.min(...times)), end: new Date(Math.max(...times)) };
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * Why (if at all) a given week cannot be dropped. Returns null when it's
 * fine to drop. Shared by the eligibility list and the server-side write
 * path, so the write path can never silently accept a week the list would
 * have excluded.
 */
export function whyNotSkippable(week: SkipCandidateWeek, now: Date): string | null {
  if (week.skippedAt) return "This week is already skipped.";
  if (!SKIPPABLE_PHASES.includes(week.phase)) {
    return week.phase === "peak"
      ? "That's a peak week. Dropping it would blunt your race fitness right when you need it most. Pick a base or build week instead, or move your race date."
      : "That's your taper or race week. Dropping it would leave you undertapered or move the finish line. Pick a base or build week instead, or move your race date.";
  }
  const range = weekDateRange(week);
  if (range && range.end < startOfDay(now)) {
    return "That week has already finished, there's nothing left to drop.";
  }
  return null;
}

/** Every base/build week that can still be dropped, soonest first. */
export function listEligibleWeeksToSkip(
  weeks: SkipCandidateWeek[],
  now: Date
): WeekEligibility[] {
  const out: WeekEligibility[] = [];
  for (const week of weeks) {
    if (whyNotSkippable(week, now) !== null) continue;
    const range = weekDateRange(week);
    if (!range) continue;
    out.push({
      weekId: week.id,
      weekNumber: week.weekNumber,
      phase: week.phase,
      startDate: range.start,
      endDate: range.end,
      hasCompletedWorkouts: week.workouts.some((w) => w.status === "completed"),
    });
  }
  return out.sort((a, b) => a.weekNumber - b.weekNumber);
}

/**
 * The week the app suggests by default: the soonest eligible base/build
 * week, preferring the one already in progress (today falls inside it) over
 * a future one — "skip a week" almost always means "this one", and only
 * falls forward to a later base/build week when the current week is
 * protected (peak/taper) or already fully behind us.
 */
export function pickDefaultWeekToSkip(
  eligible: WeekEligibility[],
  now: Date
): WeekEligibility | null {
  if (eligible.length === 0) return null;
  const today = startOfDay(now);
  const current = eligible.find((w) => w.startDate <= today && today <= w.endDate);
  return current ?? eligible[0];
}

/** Refusal explanation when there is nothing left to drop at all. */
export const NO_ELIGIBLE_WEEK_MESSAGE =
  "There's no base or build week left to drop without hurting your race. The rest of the plan is peak, taper, or race week. Move your race date, or start a shorter plan if you want to accept a reduced build.";

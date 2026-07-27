// Shared shape across the two training worlds (running workouts and Kraft
// strength sessions). Both are, at their core, the same thing: something
// scheduled for a date, with a status and a title, that may later be backed
// by a recorded activity. Everything sport-specific (pace zones/blocks for
// runs, sets/load for strength) stays in its own table and type — this file
// only covers the identity/date/status slice the feed, calendar-link picker
// and completion logic all already treat identically.
//
// This does NOT change the DB schema (workouts and strength_sessions stay
// separate tables) — it's a code-level shape shared by call sites that build
// or sort lists mixing both.

// Relative, not the "@/" alias: there is no vitest config in this repo, so the
// alias does not resolve under the test runner and an aliased import here
// breaks every test that touches this module.
import { localDayKey } from "../app-time";

export type SportKind = "run" | "strength";

// Mirrors workoutStatusEnum / strengthSessions.status (both use the same
// pgEnum under the hood — see db/schema.ts workoutStatusEnum).
export type SessionStatus = "planned" | "completed" | "skipped" | "missed";

// The minimal common slice — a run workout or a strength session both
// satisfy this without any adapter/mapping layer, because the DB columns
// backing `date`/`status`/`title`/`type` already line up 1:1 by name.
export interface SessionIdentity {
  id: string;
  date: string | Date;
  status: SessionStatus;
  // Sport-specific label: workout type ("easy" | "tempo" | ...) or strength
  // session type ("upper" | "lower" | ...). Intentionally untyped here — the
  // two enums don't overlap and forcing a shared union would just require
  // every call site to cast.
  type: string;
}

export function isCompletedSession(s: Pick<SessionIdentity, "status">): boolean {
  return s.status === "completed";
}

// A session still marked "planned" whose date has already passed is
// effectively missed, even before any cleanup job (or the user) flips the
// status row. Both worlds independently did this exact `status === "planned"
// && date < now` check inline — this is that check, extracted.
export function isPastDuePlanned(
  s: Pick<SessionIdentity, "status" | "date">,
  now: Date = new Date()
): boolean {
  // Compared by CALENDAR DAY, not by instant. A workout is dated at midnight,
  // so an instant comparison made today's session "past due" from 00:01 and
  // the plan showed it as missed while the athlete still had all day to do it.
  // localDayKey resolves both sides in the app's timezone, so this also cannot
  // slip a day for a server running in UTC.
  return s.status === "planned" && localDayKey(new Date(s.date)) < localDayKey(now);
}

// Stable date sort shared by every feed/candidate list that mixes runs and
// strength sessions (Array.sort is stable, so same-day ties keep their
// current relative order).
export function sortSessionsByDateDesc<T extends Pick<SessionIdentity, "date">>(
  items: T[]
): T[] {
  return [...items].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

export function sortSessionsByDateAsc<T extends Pick<SessionIdentity, "date">>(
  items: T[]
): T[] {
  return [...items].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
}

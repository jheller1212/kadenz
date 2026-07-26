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
  return s.status === "planned" && new Date(s.date) < now;
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

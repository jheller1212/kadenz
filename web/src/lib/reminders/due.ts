// Pure "which reminders are due right now" selection — no DB, no fetch, no
// clock reads. Kept separate from dispatch.ts (which does the DB/push I/O) so
// the actual scheduling decision is trivially unit-testable.

// Relative import (not the "@/" alias) so this pure module stays trivially
// importable from vitest without extra path-alias config, matching how the
// other pure/tested lib modules in this directory are wired.
import { zonedTimeToUtc, APP_TZ } from "../app-time";

export interface ReminderCandidate {
  workoutId: string;
  /** The workout's calendar day in the app's timezone, "YYYY-MM-DD". */
  dateKey: string;
  /** "HH:mm" 24h local time, or null — see workouts.time_of_day. */
  timeOfDay: string | null;
  status: "planned" | "completed" | "skipped" | "missed";
}

export interface ReminderSelectionSettings {
  enabled: boolean;
  /** How many minutes before the workout's start the push should fire. */
  leadMinutes: number;
  /** Fallback start time for workouts with no explicit time_of_day. */
  defaultTimeOfDay: string;
}

export interface DueReminder {
  workoutId: string;
  /** The real UTC instant the workout starts (or defaults to). */
  scheduledAt: Date;
}

/**
 * A reminder is due when `now` has passed the lead-time window but the
 * workout hasn't started yet. Once the workout's start time has passed the
 * window is gone for good — a late reminder for a run that already happened
 * (or should have) is worse than none, so this deliberately does not send
 * "catch-up" reminders after the fact.
 *
 * Precision here is bounded by how often the caller actually invokes this —
 * see the cron route for why that matters on Vercel's Hobby plan.
 */
export function selectDueReminders(
  now: Date,
  candidates: ReminderCandidate[],
  settings: ReminderSelectionSettings,
  alreadySent: ReadonlySet<string>,
  timeZone: string = APP_TZ
): DueReminder[] {
  if (!settings.enabled) return [];

  const due: DueReminder[] = [];
  for (const candidate of candidates) {
    // A workout that's been completed, skipped, or marked missed no longer
    // needs a reminder — this is the primary guard against pestering the
    // athlete about a session that's already resolved.
    if (candidate.status !== "planned") continue;
    if (alreadySent.has(candidate.workoutId)) continue;

    const startTime = candidate.timeOfDay ?? settings.defaultTimeOfDay;
    const scheduledAt = zonedTimeToUtc(candidate.dateKey, startTime, timeZone);
    const reminderOpensAt = new Date(scheduledAt.getTime() - settings.leadMinutes * 60_000);

    if (now.getTime() >= reminderOpensAt.getTime() && now.getTime() < scheduledAt.getTime()) {
      due.push({ workoutId: candidate.workoutId, scheduledAt });
    }
  }
  return due;
}

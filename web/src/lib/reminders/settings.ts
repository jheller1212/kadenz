// Server-side home of the reminder toggle + lead time. Same reasoning as
// lib/sync/garmin-config.ts: it must live in the DB, not localStorage, so the
// cron can read it with no browser involved.
//
// One row per user, addressed by user_id (unique index
// reminder_settings_user_id_uq). It used to be read as a singleton with an
// unfiltered .limit(1), which returns an arbitrary athlete's toggle and lead
// time the moment a second row exists.

import { db, reminderSettings } from "@/db";
import { eq } from "drizzle-orm";

export interface ReminderConfig {
  enabled: boolean;
  leadMinutes: number;
  /** "HH:mm" used for workouts with no explicit time_of_day. */
  defaultTimeOfDay: string;
}

const DEFAULT_CONFIG: ReminderConfig = {
  enabled: false,
  leadMinutes: 30,
  defaultTimeOfDay: "07:00",
};

export async function loadReminderConfig(userId: string): Promise<ReminderConfig> {
  const [row] = await db
    .select()
    .from(reminderSettings)
    .where(eq(reminderSettings.userId, userId))
    .limit(1);
  if (!row) return DEFAULT_CONFIG;
  return {
    enabled: row.enabled,
    leadMinutes: row.leadMinutes,
    defaultTimeOfDay: row.defaultTimeOfDay,
  };
}

export async function saveReminderConfig(userId: string, config: ReminderConfig): Promise<void> {
  // One upsert rather than select-then-insert-or-update. The two-step version
  // could interleave with a concurrent save (two devices toggling at once) so
  // that both read "no row" and both inserted, leaving one user with two rows
  // and the cron reading whichever one it happened to get. The unique index
  // on user_id rules that out, and this resolves the conflict rather than
  // failing on it.
  await db
    .insert(reminderSettings)
    .values({ ...config, userId })
    .onConflictDoUpdate({
      target: reminderSettings.userId,
      set: { ...config, updatedAt: new Date() },
    });
}

export interface UserReminderConfig {
  userId: string;
  config: ReminderConfig;
}

/**
 * Every user who has reminders switched on. This is the dispatch loop's list
 * of who to send for. A user with no row has never enabled reminders, so
 * being absent here is the same answer as the default config.
 */
export async function listEnabledReminderConfigs(): Promise<UserReminderConfig[]> {
  const rows = await db
    .select()
    .from(reminderSettings)
    .where(eq(reminderSettings.enabled, true));
  return rows.map((row) => ({
    userId: row.userId,
    config: {
      enabled: row.enabled,
      leadMinutes: row.leadMinutes,
      defaultTimeOfDay: row.defaultTimeOfDay,
    },
  }));
}

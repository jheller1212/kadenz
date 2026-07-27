// Server-side home of the reminder toggle + lead time. Same reasoning as
// lib/sync/garmin-config.ts: it must live in the DB, not localStorage, so the
// cron can read it with no browser involved. Single-athlete app → singleton
// row, upserted in place rather than keyed by user.

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

export async function loadReminderConfig(): Promise<ReminderConfig> {
  const [row] = await db.select().from(reminderSettings).limit(1);
  if (!row) return DEFAULT_CONFIG;
  return {
    enabled: row.enabled,
    leadMinutes: row.leadMinutes,
    defaultTimeOfDay: row.defaultTimeOfDay,
  };
}

export async function saveReminderConfig(config: ReminderConfig): Promise<void> {
  const [existing] = await db
    .select({ id: reminderSettings.id })
    .from(reminderSettings)
    .limit(1);

  if (existing) {
    await db
      .update(reminderSettings)
      .set({ ...config, updatedAt: new Date() })
      .where(eq(reminderSettings.id, existing.id));
  } else {
    await db.insert(reminderSettings).values(config);
  }
}

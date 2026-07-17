// ── Garmin sync configuration (server-side singletons) ───────────────────────
// The "send workouts to watch" toggle must be readable by the daily cron, so it
// lives in the DB, not localStorage. Same singleton-row-in-sync_outbox pattern
// as the Strava/GCal token storage (see strava-client.ts).

import { db, syncOutbox } from "@/db";
import { eq } from "drizzle-orm";
import { garminClient } from "./garmin-client";

const ENTITY_TYPE = "plan" as const; // reuse existing enum value
const ENTITY_ID = "00000000-0000-0000-0000-000000000002";
const CONFIG_IDEM_KEY = "garmin:config:singleton";
const IMPORT_IDEM_KEY = "garmin:import:singleton";

export interface GarminConfig {
  syncWorkouts: boolean;
}

const DEFAULT_CONFIG: GarminConfig = { syncWorkouts: false };

async function loadSingleton<T>(idemKey: string): Promise<T | null> {
  try {
    const [row] = await db
      .select({ payload: syncOutbox.payload })
      .from(syncOutbox)
      .where(eq(syncOutbox.idempotencyKey, idemKey))
      .limit(1);
    if (!row?.payload) return null;
    return row.payload as unknown as T;
  } catch {
    return null;
  }
}

async function saveSingleton(idemKey: string, payload: Record<string, unknown>): Promise<void> {
  await db
    .insert(syncOutbox)
    .values({
      entityType: ENTITY_TYPE,
      entityId: ENTITY_ID,
      action: "update",
      target: "gcal", // singleton storage row — never picked up by any processor
      status: "completed",
      idempotencyKey: idemKey,
      payload,
      attempts: 0,
    })
    .onConflictDoUpdate({
      target: syncOutbox.idempotencyKey,
      set: { payload },
    });
}

export async function loadGarminConfig(): Promise<GarminConfig> {
  const stored = await loadSingleton<Partial<GarminConfig>>(CONFIG_IDEM_KEY);
  return { ...DEFAULT_CONFIG, ...stored };
}

export async function saveGarminConfig(config: GarminConfig): Promise<void> {
  await saveSingleton(CONFIG_IDEM_KEY, config as unknown as Record<string, unknown>);
}

/** True when workout fan-out to Garmin should happen: env configured AND the
 * user turned the toggle on. */
export async function isGarminWorkoutSyncEnabled(): Promise<boolean> {
  if (!garminClient.isConfigured()) return false;
  return (await loadGarminConfig()).syncWorkouts;
}

// ── Activity-import bookmark ─────────────────────────────────────────────────

interface ImportState {
  lastImportAt: string; // ISO
}

/** Overlap window when re-querying the worker: activities recorded before the
 * last import but uploaded after it (late watch sync) must still be found.
 * Duplicates are cheap — the garmin_id column dedupes them. */
const IMPORT_OVERLAP_MS = 48 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

export async function loadImportSince(): Promise<Date> {
  const stored = await loadSingleton<ImportState>(IMPORT_IDEM_KEY);
  if (stored?.lastImportAt) {
    const t = Date.parse(stored.lastImportAt);
    if (!Number.isNaN(t)) return new Date(t - IMPORT_OVERLAP_MS);
  }
  return new Date(Date.now() - DEFAULT_LOOKBACK_MS);
}

export async function saveImportTimestamp(date: Date): Promise<void> {
  await saveSingleton(IMPORT_IDEM_KEY, { lastImportAt: date.toISOString() });
}

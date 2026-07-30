// ── Garmin sync configuration (per-user state) ────────────────────────────────
// The "send workouts to watch" toggle and the activity-import bookmark used to
// be single rows in sync_outbox, addressed by a fixed idempotency key. That
// column is UNIQUE table-wide, so there was exactly one row per key for the
// whole installation, a single shared mutable cell.
//
// Garmin itself is NOT per-user the way Strava/Google are: it's one physical
// watch reached through installation-level worker credentials
// (garminClient.isConfigured()), not per-user OAuth, and only the owner can
// ever hold a garminWorkoutId. So this is not "each athlete gets their own
// watch", today, in practice, only the owner's row here is ever populated.
//
// What keying by userId actually buys: the moment ANYTHING iterates users
// (a cron fan-out, a background job), a shared singleton row becomes
// "wherever the last iteration finished" rather than anyone's actual
// progress, for the import bookmark that meant re-importing weeks of
// activities or skipping recent ones depending on iteration order; for the
// toggle it meant one iteration's write silently deciding it for everyone.
// A caller supplying its own id explicitly, into its own row, is what makes
// that clobbering impossible, independent of whether the id it supplies
// ever resolves to a second real watch.
//
// Both now live in user_integration_state, keyed by (user_id, key). See
// lib/sync/user-state.ts for the storage itself and why it exists.

import { loadUserState, saveUserState } from "./user-state";
import { garminClient } from "./garmin-client";

export interface GarminConfig {
  syncWorkouts: boolean;
}

const DEFAULT_CONFIG: GarminConfig = { syncWorkouts: false };

export async function loadGarminConfig(userId: string): Promise<GarminConfig> {
  const stored = await loadUserState<Partial<GarminConfig>>(userId, "garmin:config");
  return { ...DEFAULT_CONFIG, ...stored };
}

export async function saveGarminConfig(userId: string, config: GarminConfig): Promise<void> {
  await saveUserState(userId, "garmin:config", config as unknown as Record<string, unknown>);
}

/** True when workout fan-out to Garmin should happen for this user: env
 * configured AND the user turned the toggle on. isConfigured() is
 * installation-level env config (the garmin-worker deployment itself), so it
 * correctly stays unscoped, it is not a per-user setting. */
export async function isGarminWorkoutSyncEnabled(userId: string): Promise<boolean> {
  if (!garminClient.isConfigured()) return false;
  return (await loadGarminConfig(userId)).syncWorkouts;
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

export async function loadImportSince(userId: string): Promise<Date> {
  const stored = await loadUserState<ImportState>(userId, "garmin:import");
  if (stored?.lastImportAt) {
    const t = Date.parse(stored.lastImportAt);
    if (!Number.isNaN(t)) return new Date(t - IMPORT_OVERLAP_MS);
  }
  return new Date(Date.now() - DEFAULT_LOOKBACK_MS);
}

export async function saveImportTimestamp(userId: string, date: Date): Promise<void> {
  await saveUserState(userId, "garmin:import", { lastImportAt: date.toISOString() });
}

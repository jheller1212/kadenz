// Server-side reader/writer for the athlete's device and app answer
// (users.device_setup_at / users.device_connections, added in 0060).
//
// The pure half lives in lib/device-setup.ts and is shared with the browser.
// This module is the only place that reads or writes the columns, so the
// "have they answered?" question has one implementation rather than one per
// caller (docs/DUPLICATION.md).

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, OWNER_USER_ID } from "@/db/schema";
import {
  parseConnections,
  UNANSWERED_DEVICE_SETUP,
  type ConnectionId,
  type DeviceSetup,
} from "@/lib/device-setup";
import { garminClient } from "@/lib/sync/garmin-client";

/**
 * Whether Garmin is honest to offer this caller at all.
 *
 * Not a per-user connection: it's a single physical watch reached through
 * installation-level worker credentials, so only the owner's workouts can
 * ever carry a garminWorkoutId. Shared by /api/user/device-setup and
 * /api/today/bootstrap so both answer the same question the same way.
 */
export function garminOfferedTo(userId: string): boolean {
  return userId === OWNER_USER_ID && garminClient.isConfigured();
}

/**
 * The athlete's answer, or the unanswered state if the row is missing.
 *
 * A missing user row means a caller passed an id that no longer exists.
 * Treating that as unanswered is the safe direction: it keeps the readiness
 * card's warm-up copy behaving exactly as it did before this feature, rather
 * than silently claiming a nonexistent athlete records by hand.
 */
export async function loadDeviceSetup(userId: string): Promise<DeviceSetup> {
  const [row] = await db
    .select({
      deviceSetupAt: users.deviceSetupAt,
      deviceConnections: users.deviceConnections,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return UNANSWERED_DEVICE_SETUP;
  return {
    completedAt: row.deviceSetupAt ? row.deviceSetupAt.toISOString() : null,
    connections: parseConnections(row.deviceConnections),
  };
}

/**
 * Records the answer. Called with an empty array when the athlete picks
 * nothing, which is why the timestamp is written unconditionally: the
 * timestamp is the answer, the array is only its content.
 */
export async function saveDeviceSetup(
  userId: string,
  connections: ConnectionId[]
): Promise<DeviceSetup> {
  const completedAt = new Date();
  await db
    .update(users)
    .set({
      deviceSetupAt: completedAt,
      deviceConnections: connections,
      updatedAt: completedAt,
    })
    .where(eq(users.id, userId));
  return { completedAt: completedAt.toISOString(), connections };
}

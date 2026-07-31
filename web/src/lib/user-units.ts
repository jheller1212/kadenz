// Server-side reader for the athlete's unit preference (users.distance_unit /
// users.weight_unit, added in 0057).
//
// Everything the athlete looks at in the browser reads units from
// localStorage via lib/settings.ts, and that stays the client's source of
// truth. This module exists for the surfaces with no browser attached: the
// Garmin workout label, the Google Calendar event, and the push reminder body
// are all built by the cron, which cannot see localStorage.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import type { UserId } from "@/lib/user-id";

export type DistanceUnit = "km" | "miles";
export type WeightUnit = "kg" | "lbs";

export interface UserUnits {
  distanceUnit: DistanceUnit;
  weightUnit: WeightUnit;
}

export const DEFAULT_USER_UNITS: UserUnits = { distanceUnit: "km", weightUnit: "kg" };

/**
 * Units for one user, falling back to the defaults if the row is missing.
 *
 * A missing user row means a caller passed an id that no longer exists, which
 * is not worth failing a calendar sync over: km/kg is what that athlete would
 * have seen anyway, since it is also the localStorage default.
 */
export async function loadUserUnits(userId: UserId): Promise<UserUnits> {
  const [row] = await db
    .select({ distanceUnit: users.distanceUnit, weightUnit: users.weightUnit })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return DEFAULT_USER_UNITS;
  return {
    // The columns are CHECK-constrained to exactly these values, so the
    // narrowing below cannot lose information. Drizzle types a text column as
    // string, which is the only reason it is written out.
    distanceUnit: row.distanceUnit === "miles" ? "miles" : "km",
    weightUnit: row.weightUnit === "lbs" ? "lbs" : "kg",
  };
}

export async function saveUserUnits(userId: UserId, units: UserUnits): Promise<void> {
  await db
    .update(users)
    .set({ distanceUnit: units.distanceUnit, weightUnit: units.weightUnit, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

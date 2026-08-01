import { and, eq, isNull } from "drizzle-orm";
import { db, strengthPlanSettings } from "@/db";
import { ownedBy } from "@/lib/api/owned";

// Shared with /api/today/bootstrap, which reads the same row to surface the
// weekly Kraft target on the Today screen without a second round trip.

export function profCond(profileId: string | null) {
  return and(
    ownedBy(strengthPlanSettings),
    profileId
      ? eq(strengthPlanSettings.profileId, profileId)
      : isNull(strengthPlanSettings.profileId)
  );
}

export async function getPlanSettings(profileId: string | null) {
  const [settings] = await db
    .select()
    .from(strengthPlanSettings)
    .where(profCond(profileId));
  return settings ?? null;
}

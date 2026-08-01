import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import { db, wellnessLogs } from "@/db";
import { ownedBy } from "@/lib/api/owned";

// Shared with /api/today/bootstrap, which reads today's window for the daily
// check-in card.

export async function listWellnessLogs(
  profileId: string | null,
  opts: { from?: Date | null; to?: Date | null } = {}
) {
  const conds = [
    ownedBy(wellnessLogs),
    profileId ? eq(wellnessLogs.profileId, profileId) : isNull(wellnessLogs.profileId),
  ];
  if (opts.from) conds.push(gte(wellnessLogs.date, opts.from));
  if (opts.to) conds.push(lte(wellnessLogs.date, opts.to));
  return db
    .select()
    .from(wellnessLogs)
    .where(and(...conds))
    .orderBy(asc(wellnessLogs.date));
}

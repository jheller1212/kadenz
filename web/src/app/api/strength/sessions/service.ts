import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { db, strengthSessions } from "@/db";
import { ownedBy } from "@/lib/api/owned";

// Shared with /api/today/bootstrap, which needs exactly the list shape (no
// sets) for the current week's strength cards on the Today screen.

export async function listStrengthSessions(
  profileId: string | null,
  opts: { from?: Date | null; to?: Date | null; includeSets?: boolean } = {}
) {
  const conds = [
    ownedBy(strengthSessions),
    profileId
      ? eq(strengthSessions.profileId, profileId)
      : isNull(strengthSessions.profileId),
  ];
  if (opts.from) conds.push(gte(strengthSessions.date, opts.from));
  if (opts.to) conds.push(lte(strengthSessions.date, opts.to));

  return opts.includeSets
    ? db.query.strengthSessions.findMany({
        where: and(...conds),
        orderBy: (s, { desc }) => [desc(s.date)],
        with: { sets: { orderBy: (st, { asc }) => [asc(st.setNumber)] } },
      })
    : db.query.strengthSessions.findMany({
        where: and(...conds),
        orderBy: (s, { desc }) => [desc(s.date)],
        // List/calendar consumers use only these scalars — no set join.
        columns: {
          id: true,
          date: true,
          dayOfWeek: true,
          type: true,
          title: true,
          status: true,
          targetDurationMinutes: true,
          durationMinutes: true,
          gcalEventId: true,
          garminWorkoutId: true,
        },
      });
}

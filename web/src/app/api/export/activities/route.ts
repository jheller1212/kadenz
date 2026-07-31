import { and, asc, gt } from "drizzle-orm";
import { db, activities } from "@/db";
import { csvRow } from "@/lib/csv";
import { withSession } from "@/lib/api/with-session";
import { ownedBy } from "@/lib/api/owned";
import { getVerifiedProfileId } from "@/lib/profiles";

// ── GET /api/export/activities ────────────────────────────────────────────────
// Streams every logged activity as CSV. Paginated by a keyset cursor on `id`
// (a stable total order regardless of dataset size) so a multi-year history
// is never held in memory as one array — each batch is read, written, and
// discarded before the next is fetched.

const BATCH_SIZE = 500;

const HEADER = [
  "date",
  "type",
  "distance_km",
  "duration_seconds",
  "avg_pace_sec_per_km",
  "avg_hr_bpm",
  "max_hr_bpm",
  "elevation_gain_m",
];

export const GET = withSession(async (request) => {
  const encoder = new TextEncoder();

  // Strava is the owner's device, so a guest profile sees no activities at all
  // in the app (see api/activities/route.ts, which returns [] for a guest).
  // The export has to honour the same rule: without this it streamed every
  // activity to whoever asked, handing a household guest the owner's entire
  // run history that the app itself never shows them. Scoping by a column is
  // not possible here because `activities` has no profile_id; ownership is the
  // rule itself, so a guest gets a header-only file. Verified, not raw: an
  // unverified cookie could name another athlete's profile id and would still
  // read as "not the owner" here, so it wouldn't grant access on its own -- but
  // it must not read as "owner" either just because it failed the guest check.
  const isGuest = (await getVerifiedProfileId(request)) != null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(csvRow(HEADER) + "\n"));

      if (isGuest) {
        controller.close();
        return;
      }

      let cursor: string | null = null;
      try {
        for (;;) {
          const rows = await db
            .select({
              id: activities.id,
              startDate: activities.startDate,
              createdAt: activities.createdAt,
              sportType: activities.sportType,
              distanceKm: activities.distanceKm,
              durationSeconds: activities.durationSeconds,
              avgPaceSecKm: activities.avgPaceSecKm,
              avgHr: activities.avgHr,
              maxHr: activities.maxHr,
              elevationGain: activities.elevationGain,
            })
            .from(activities)
            .where(cursor ? and(ownedBy(activities), gt(activities.id, cursor)) : ownedBy(activities))
            .orderBy(asc(activities.id))
            .limit(BATCH_SIZE);

          if (rows.length === 0) break;

          let chunk = "";
          for (const r of rows) {
            const date = (r.startDate ?? r.createdAt).toISOString();
            chunk +=
              csvRow([
                date,
                r.sportType ?? "",
                r.distanceKm,
                r.durationSeconds,
                r.avgPaceSecKm,
                r.avgHr,
                r.maxHr,
                r.elevationGain,
              ]) + "\n";
          }
          controller.enqueue(encoder.encode(chunk));

          cursor = rows[rows.length - 1].id;
          if (rows.length < BATCH_SIZE) break;
        }
        controller.close();
      } catch (err) {
        console.error("Error streaming activities export:", err);
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="kadenz-activities.csv"',
    },
  });
});

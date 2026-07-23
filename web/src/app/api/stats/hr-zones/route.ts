import { NextRequest } from "next/server";
import { z } from "zod";
import { db, activities } from "@/db";
import { and, gte, isNotNull, lt } from "drizzle-orm";
import { sportBucket, type SportBucket } from "@/lib/sport";

// ── GET /api/stats/hr-zones?month=YYYY-MM&bounds=139,152,160,169&max=185 ─────
// Time in HR zones for one month. Zone bounds are client-side (settings), so
// the client passes them along. HR streams are not persisted — the activity
// detail page fetches them live from Strava — so aggregating a whole month
// that way would cost one Strava call per activity on every Stats view.
// Instead we approximate from what IS in the DB: per-km splits carry an
// average_heartrate + moving_time (km-level resolution), and activities
// without splits (e.g. strength) fall back to avgHr over the full duration.

const QuerySchema = z
  .object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
    // Arbitrary range (Week / YTD / 1-Year etc.) — an alternative to month.
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    bounds: z
      .string()
      .transform((s) => s.split(",").map(Number))
      .pipe(z.array(z.number().int().min(40).max(250)).length(4)),
    max: z.coerce.number().int().min(60).max(250),
    // Filter to one sport bucket; "all" (default) counts everything.
    sport: z.enum(["all", "run", "ride", "swim", "strength", "other"]).default("all"),
  })
  .refine((q) => Boolean(q.month) || (Boolean(q.from) && Boolean(q.to)), {
    message: "Provide month, or both from and to",
  });

interface RawSplit {
  average_heartrate?: number;
  moving_time?: number;
  elapsed_time?: number;
}

function zoneIndexFor(hr: number, bounds: number[]): number {
  for (let z = 0; z < bounds.length; z++) {
    if (hr < bounds[z]) return z;
  }
  return 4;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const parsed = QuerySchema.safeParse({
    month: searchParams.get("month") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    bounds: searchParams.get("bounds"),
    max: searchParams.get("max"),
    sport: searchParams.get("sport") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 }
    );
  }
  const { month, from, to, bounds, sport } = parsed.data;

  let monthStart: Date;
  let monthEnd: Date;
  if (from && to) {
    monthStart = new Date(from);
    monthEnd = new Date(to);
  } else {
    const [year, mon] = month!.split("-").map(Number);
    monthStart = new Date(year, mon - 1, 1);
    monthEnd = new Date(year, mon, 1);
  }

  try {
    // Guard payload cost: only the columns the aggregation needs.
    const rows = await db
      .select({
        startDate: activities.startDate,
        splitsJson: activities.splitsJson,
        avgHr: activities.avgHr,
        durationSeconds: activities.durationSeconds,
        sportType: activities.sportType,
        strengthSessionId: activities.strengthSessionId,
      })
      .from(activities)
      .where(
        and(
          isNotNull(activities.startDate),
          gte(activities.startDate, monthStart),
          lt(activities.startDate, monthEnd)
        )
      );

    const seconds = [0, 0, 0, 0, 0];
    let counted = 0;
    // Buckets that have HR-usable data in this range — drives the sport chips
    // on the client, independent of the currently selected filter.
    const availableSports = new Set<SportBucket>();

    for (const row of rows) {
      const bucket = sportBucket(row.sportType, row.strengthSessionId != null);
      const include = sport === "all" || bucket === sport;

      // Gather this row's per-zone seconds first, so we know whether it has any
      // HR-usable data before deciding availability / aggregation.
      const rowSeconds = [0, 0, 0, 0, 0];
      let hasHr = false;
      if (Array.isArray(row.splitsJson)) {
        for (const s of row.splitsJson as RawSplit[]) {
          const hr = s.average_heartrate;
          const dt = s.moving_time ?? s.elapsed_time;
          if (hr == null || hr <= 0 || dt == null || dt <= 0) continue;
          rowSeconds[zoneIndexFor(hr, bounds)] += dt;
          hasHr = true;
        }
      }
      // No per-split HR (strength sessions, manual entries): whole duration in
      // the zone of the activity's average HR.
      if (!hasHr && row.avgHr && row.avgHr > 0 && row.durationSeconds) {
        rowSeconds[zoneIndexFor(row.avgHr, bounds)] += row.durationSeconds;
        hasHr = true;
      }

      if (!hasHr) continue;
      availableSports.add(bucket);
      if (!include) continue;
      for (let z = 0; z < 5; z++) seconds[z] += rowSeconds[z];
      counted++;
    }

    return Response.json({
      zones: seconds.map((s) => ({ seconds: Math.round(s) })),
      activities: counted,
      availableSports: [...availableSports],
    });
  } catch (err) {
    console.error("Error aggregating HR zone time:", err);
    return Response.json({ error: "Failed to aggregate" }, { status: 500 });
  }
}

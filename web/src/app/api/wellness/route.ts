import { NextRequest } from "next/server";
import { z } from "zod";
import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import { db, wellnessLogs } from "@/db";
import { getActiveProfileId } from "@/lib/profiles";

const UpsertSchema = z.object({
  date: z.string().datetime(),
  restDay: z.boolean().optional(),
  illness: z.boolean().optional(),
  injury: z.boolean().optional(),
  bodyweightKg: z.number().positive().nullable().optional(),
  energy: z.number().int().min(1).max(5).nullable().optional(),
  sleepQuality: z.number().int().min(1).max(5).nullable().optional(),
  soreness: z.number().int().min(1).max(5).nullable().optional(),
  note: z.string().optional(),
});

function dayStart(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// ── GET /api/wellness?from=&to= ───────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const profileId = getActiveProfileId(request);
  try {
    const conds = [
      profileId
        ? eq(wellnessLogs.profileId, profileId)
        : isNull(wellnessLogs.profileId),
    ];
    if (from) conds.push(gte(wellnessLogs.date, new Date(from)));
    if (to) conds.push(lte(wellnessLogs.date, new Date(to)));
    const rows = await db
      .select()
      .from(wellnessLogs)
      .where(and(...conds))
      .orderBy(asc(wellnessLogs.date));
    return Response.json(rows);
  } catch (err) {
    console.error("DB error listing wellness logs:", err);
    return Response.json({ error: "Failed to fetch wellness" }, { status: 500 });
  }
}

// ── PUT /api/wellness ─────────────────────────────────────────────────────────
// Upsert the daily check-in (one row per calendar day).

export async function PUT(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = UpsertSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 }
    );
  }
  const data = parsed.data;
  const date = dayStart(new Date(data.date));
  const profileId = getActiveProfileId(request);

  try {
    // Only fields the request actually sent. A partial update (one slider tap
    // from another device) must not null out bodyweight/energy/sleep the user
    // logged elsewhere — the previous `?? null` wrote every column every time.
    const patch: Record<string, unknown> = {};
    if (data.restDay !== undefined) patch.restDay = data.restDay;
    if (data.illness !== undefined) patch.illness = data.illness;
    if (data.injury !== undefined) patch.injury = data.injury;
    if (data.bodyweightKg !== undefined) patch.bodyweightKg = data.bodyweightKg;
    if (data.energy !== undefined) patch.energy = data.energy;
    if (data.sleepQuality !== undefined) patch.sleepQuality = data.sleepQuality;
    if (data.soreness !== undefined) patch.soreness = data.soreness;
    if (data.note !== undefined) patch.note = data.note;

    // Insert needs the non-null defaults the columns expect for a brand-new row.
    const insertValues = {
      date,
      profileId,
      restDay: data.restDay ?? false,
      illness: data.illness ?? false,
      injury: data.injury ?? false,
      bodyweightKg: data.bodyweightKg ?? null,
      energy: data.energy ?? null,
      sleepQuality: data.sleepQuality ?? null,
      soreness: data.soreness ?? null,
      note: data.note ?? null,
    };
    // Manual upsert: the (date, profile) uniqueness is a COALESCE expression
    // index (see 0005) that onConflictDoUpdate can't target.
    const [existing] = await db
      .select({ id: wellnessLogs.id })
      .from(wellnessLogs)
      .where(
        and(
          eq(wellnessLogs.date, date),
          profileId
            ? eq(wellnessLogs.profileId, profileId)
            : isNull(wellnessLogs.profileId)
        )
      )
      .limit(1);
    const [row] = existing
      ? await db
          .update(wellnessLogs)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(wellnessLogs.id, existing.id))
          .returning()
      : await db.insert(wellnessLogs).values(insertValues).returning();
    return Response.json(row);
  } catch (err) {
    console.error("DB error upserting wellness log:", err);
    return Response.json({ error: "Failed to save wellness" }, { status: 500 });
  }
}

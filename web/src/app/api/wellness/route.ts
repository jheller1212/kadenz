import { NextRequest } from "next/server";
import { z } from "zod";
import { and, asc, gte, lte } from "drizzle-orm";
import { db, wellnessLogs } from "@/db";

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
  try {
    const conds = [];
    if (from) conds.push(gte(wellnessLogs.date, new Date(from)));
    if (to) conds.push(lte(wellnessLogs.date, new Date(to)));
    const rows = await db
      .select()
      .from(wellnessLogs)
      .where(conds.length ? and(...conds) : undefined)
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

  try {
    const values = {
      date,
      restDay: data.restDay ?? false,
      illness: data.illness ?? false,
      injury: data.injury ?? false,
      bodyweightKg: data.bodyweightKg ?? null,
      energy: data.energy ?? null,
      sleepQuality: data.sleepQuality ?? null,
      soreness: data.soreness ?? null,
      note: data.note ?? null,
    };
    const [row] = await db
      .insert(wellnessLogs)
      .values(values)
      .onConflictDoUpdate({
        target: wellnessLogs.date,
        set: { ...values, updatedAt: new Date() },
      })
      .returning();
    return Response.json(row);
  } catch (err) {
    console.error("DB error upserting wellness log:", err);
    return Response.json({ error: "Failed to save wellness" }, { status: 500 });
  }
}

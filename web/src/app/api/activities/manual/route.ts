import { NextRequest } from "next/server";
import { z } from "zod";
import { db, activities } from "@/db";

const ManualActivitySchema = z.object({
  name: z.string().min(1).max(120),
  date: z.string().datetime(),
  distanceKm: z.number().positive().max(500),
  durationSeconds: z.number().int().positive().max(24 * 3600),
});

// ── POST /api/activities/manual ───────────────────────────────────────────────
// Adds a manually-logged activity (no Strava id → shows as source "manual").

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ManualActivitySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 }
    );
  }

  const { name, date, distanceKm, durationSeconds } = parsed.data;

  try {
    const [created] = await db
      .insert(activities)
      .values({
        name,
        startDate: new Date(date),
        distanceKm,
        durationSeconds,
        avgPaceSecKm: Math.round(durationSeconds / distanceKm),
      })
      .returning();

    return Response.json(created, { status: 201 });
  } catch (err) {
    console.error("DB error creating manual activity:", err);
    return Response.json({ error: "Failed to create activity" }, { status: 500 });
  }
}

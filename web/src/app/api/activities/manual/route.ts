import { NextRequest } from "next/server";
import { z } from "zod";
import { db, activities } from "@/db";

const ManualActivitySchema = z
  .object({
    kind: z.enum(["run", "strength"]).optional().default("run"),
    name: z.string().min(1).max(120),
    date: z.string().datetime(),
    distanceKm: z.number().positive().max(500).optional(),
    durationSeconds: z.number().int().positive().max(24 * 3600),
  })
  .refine((d) => d.kind === "strength" || (d.distanceKm ?? 0) > 0, {
    message: "Runs need a distance.",
    path: ["distanceKm"],
  });

// ── POST /api/activities/manual ───────────────────────────────────────────────
// Adds a manually-logged, off-plan ("instant") activity — a run or a strength
// session — with no Strava id. Runs carry distance + pace; strength sessions are
// tagged sport_type="WeightTraining" so the unified feed renders them correctly.

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

  const { kind, name, date, distanceKm, durationSeconds } = parsed.data;
  const isStrength = kind === "strength";

  try {
    const [created] = await db
      .insert(activities)
      .values({
        name,
        startDate: new Date(date),
        sportType: isStrength ? "WeightTraining" : "Run",
        distanceKm: isStrength ? null : distanceKm,
        durationSeconds,
        avgPaceSecKm:
          isStrength || !distanceKm
            ? null
            : Math.round(durationSeconds / distanceKm),
      })
      .returning();

    return Response.json(created, { status: 201 });
  } catch (err) {
    console.error("DB error creating manual activity:", err);
    return Response.json({ error: "Failed to create activity" }, { status: 500 });
  }
}

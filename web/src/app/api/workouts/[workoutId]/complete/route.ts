import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, workouts } from "@/db";
import { queueWorkoutSync } from "@/lib/sync/sync-manager";
import { isConnected } from "@/lib/sync/gcal-client";
import { requireRequestUser } from "@/lib/request-user";

const CompleteSchema = z.object({
  actualKm: z.number().nonnegative().optional(),
  durationSeconds: z.number().int().nonnegative().optional(),
  rpe: z.number().min(0).max(10).optional(),
});

// ── PATCH /api/workouts/[workoutId]/complete ──────────────────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ workoutId: string }> }
) {
  const { userId, response: unauth } = await requireRequestUser(request);
  if (unauth) return unauth;
  const { workoutId } = await params;

  let body: unknown = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CompleteSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 }
    );
  }

  try {
    // Only overwrite fields that were sent — a later RPE-only call must not
    // null out a previously recorded distance.
    const [updated] = await db
      .update(workouts)
      .set({
        status: "completed",
        ...(parsed.data.actualKm !== undefined ? { actualKm: parsed.data.actualKm } : {}),
        ...(parsed.data.durationSeconds !== undefined
          ? { actualDurationSeconds: parsed.data.durationSeconds }
          : {}),
        ...(parsed.data.rpe !== undefined ? { rpe: parsed.data.rpe } : {}),
        updatedAt: new Date(),
      })
      .where(eq(workouts.id, workoutId))
      .returning();

    if (!updated) {
      return Response.json({ error: "Workout not found" }, { status: 404 });
    }

    // Queue gcal update if connected
    isConnected(userId).then((connected) => {
      if (connected) {
        queueWorkoutSync(workoutId, "update", userId, "gcal").catch((err) => {
          console.error("Failed to queue gcal update:", err);
        });
      }
    }).catch(() => {});

    return Response.json(updated);
  } catch (err) {
    console.error("DB error completing workout:", err);
    return Response.json({ error: "Failed to complete workout" }, { status: 500 });
  }
}

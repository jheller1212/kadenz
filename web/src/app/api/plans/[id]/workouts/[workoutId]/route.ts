import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db, workouts } from "@/db";

const WorkoutPatchSchema = z.object({
  status: z.enum(["planned", "completed", "skipped", "missed"]).optional(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  targetKm: z.number().nonnegative().optional(),
  actualKm: z.number().nonnegative().optional(),
  targetDurationMinutes: z.number().int().positive().optional(),
}).strict();

// ── PATCH /api/plans/[id]/workouts/[workoutId] ────────────────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; workoutId: string }> }
) {
  const { id, workoutId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = WorkoutPatchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 }
    );
  }

  const updates = parsed.data;
  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "No fields to update" }, { status: 422 });
  }

  try {
    const [updated] = await db
      .update(workouts)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(workouts.id, workoutId), eq(workouts.planId, id)))
      .returning();

    if (!updated) {
      return Response.json({ error: "Workout not found" }, { status: 404 });
    }

    return Response.json(updated);
  } catch (err) {
    console.error("DB error updating workout:", err);
    return Response.json({ error: "Failed to update workout" }, { status: 500 });
  }
}

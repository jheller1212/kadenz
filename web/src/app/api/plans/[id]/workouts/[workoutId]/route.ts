import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db, workouts } from "@/db";
import { queueWorkoutSync } from "@/lib/sync/sync-manager";
import { isConnected } from "@/lib/sync/gcal-client";

const WorkoutPatchSchema = z.object({
  status: z.enum(["planned", "completed", "skipped", "missed"]).optional(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  targetKm: z.number().nonnegative().optional(),
  actualKm: z.number().nonnegative().optional(),
  targetDurationMinutes: z.number().int().positive().optional(),
  // Reschedule to a new day — updates the calendar event too.
  date: z.string().datetime().optional(),
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

  const { date, ...rest } = parsed.data;
  if (Object.keys(parsed.data).length === 0) {
    return Response.json({ error: "No fields to update" }, { status: 422 });
  }

  // A reschedule also updates the day-of-week derived column.
  const setValues: Record<string, unknown> = { ...rest, updatedAt: new Date() };
  if (date) {
    const d = new Date(date);
    setValues.date = d;
    setValues.dayOfWeek = d.getDay();
  }

  try {
    const [updated] = await db
      .update(workouts)
      .set(setValues)
      .where(and(eq(workouts.id, workoutId), eq(workouts.planId, id)))
      .returning();

    if (!updated) {
      return Response.json({ error: "Workout not found" }, { status: 404 });
    }

    // Reschedule fans out to Google Calendar (same pattern as complete).
    if (date) {
      isConnected()
        .then((connected) => {
          if (connected) {
            queueWorkoutSync(workoutId, "update", "gcal").catch((err) =>
              console.error("Failed to queue gcal reschedule:", err)
            );
          }
        })
        .catch(() => {});
    }

    return Response.json(updated);
  } catch (err) {
    console.error("DB error updating workout:", err);
    return Response.json({ error: "Failed to update workout" }, { status: 500 });
  }
}

import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db, workouts, blocks } from "@/db";
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
  // Hand-tune: shift every pace target by this many sec/km (positive = slower).
  paceOffsetSecKm: z.number().int().min(-90).max(90).optional(),
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

  const { date, paceOffsetSecKm, ...rest } = parsed.data;
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
  // Distance/pace overrides mark the workout as hand-tuned.
  if (rest.targetKm !== undefined || paceOffsetSecKm !== undefined) {
    setValues.edited = true;
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

    // Apply block-level overrides so the session view matches the new numbers.
    if (rest.targetKm !== undefined || paceOffsetSecKm !== undefined) {
      const blockRows = await db
        .select()
        .from(blocks)
        .where(eq(blocks.workoutId, workoutId));

      // Distance: scale plain-distance work blocks so warm-up/cool-down stay
      // fixed and the session sums to the new target. Rep-based interval
      // blocks are left alone (edit pace instead).
      let scale: number | null = null;
      if (rest.targetKm !== undefined) {
        const fixedKm = blockRows
          .filter((b) => b.type !== "work" && b.distanceKm != null)
          .reduce((sum, b) => sum + (b.distanceKm ?? 0), 0);
        const plainWork = blockRows.filter(
          (b) => b.type === "work" && b.distanceKm != null && !b.reps
        );
        const workKm = plainWork.reduce((sum, b) => sum + (b.distanceKm ?? 0), 0);
        if (workKm > 0) {
          scale = Math.max(0.1, (rest.targetKm - fixedKm) / workKm);
        }
      }

      for (const b of blockRows) {
        const patch: Record<string, unknown> = {};
        if (scale != null && b.type === "work" && b.distanceKm != null && !b.reps) {
          patch.distanceKm = Math.max(0.2, Math.round(b.distanceKm * scale * 10) / 10);
        }
        if (paceOffsetSecKm) {
          const shift = (v: number | null) =>
            v == null ? undefined : Math.max(120, v + paceOffsetSecKm);
          if (b.targetPaceSecKm != null) patch.targetPaceSecKm = shift(b.targetPaceSecKm);
          if (b.minPaceSecKm != null) patch.minPaceSecKm = shift(b.minPaceSecKm);
          if (b.maxPaceSecKm != null) patch.maxPaceSecKm = shift(b.maxPaceSecKm);
        }
        if (Object.keys(patch).length > 0) {
          await db.update(blocks).set(patch).where(eq(blocks.id, b.id));
        }
      }
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

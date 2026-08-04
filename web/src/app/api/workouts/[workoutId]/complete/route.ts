import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, workouts } from "@/db";
import { queueWorkoutSync } from "@/lib/sync/sync-manager";
import { isConnected } from "@/lib/sync/gcal-client";
import { withSession } from "@/lib/api/with-session";
import { currentUserId } from "@/db/with-user";
import { ownedBy, requireOwned } from "@/lib/api/owned";
import { weekMilestoneForCompletedWorkout } from "@/lib/plan-engine/week-milestone-service";

const CompleteSchema = z.object({
  actualKm: z.number().nonnegative().optional(),
  durationSeconds: z.number().int().nonnegative().optional(),
  rpe: z.number().min(0).max(10).optional(),
});

// ── PATCH /api/workouts/[workoutId]/complete ──────────────────────────────────

export const PATCH = withSession(async (
  request: NextRequest,
  { params }: { params: Promise<{ workoutId: string }> }
) => {
  const { workoutId } = await params;

  // Checked before the body, since an empty `{}` is a valid request here and
  // must not be mistaken for proof the workout wasn't checked.
  await requireOwned(workouts, workoutId);

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
      .where(and(eq(workouts.id, workoutId), ownedBy(workouts)))
      .returning();

    if (!updated) {
      return Response.json({ error: "Workout not found" }, { status: 404 });
    }

    // Queue gcal update if connected. Captured once, synchronously, while
    // still inside the request's AsyncLocalStorage scope — the .then below
    // runs after this scope may have already unwound.
    const completingUserId = currentUserId();
    isConnected(completingUserId).then((connected) => {
      if (connected) {
        queueWorkoutSync(workoutId, "update", completingUserId, "gcal").catch((err) => {
          console.error("Failed to queue gcal update:", err);
        });
      }
    }).catch(() => {});

    // Did this completion finish the week it's in? Checked against every
    // sibling workout's real status (not a counter) — see celebrations.ts
    // for why a mostly-missed week must never read as a win.
    const weekMilestone = await weekMilestoneForCompletedWorkout(updated.weekId);

    return Response.json({ ...updated, weekMilestone });
  } catch (err) {
    console.error("DB error completing workout:", err);
    return Response.json({ error: "Failed to complete workout" }, { status: 500 });
  }
});

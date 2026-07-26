import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db, workouts, blocks } from "@/db";
import { queueWorkoutSync } from "@/lib/sync/sync-manager";
import { isConnected } from "@/lib/sync/gcal-client";
import { queueGarminWorkoutMove } from "@/lib/sync/garmin-sync";

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
  // "HH:mm" 24h local, or null to clear. Undefined (field omitted) leaves it
  // untouched — only an explicit null means "no specific time" again.
  timeOfDay: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable()
    .optional(),
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
    // Land ahead of anything already on the target day (typically a rest
    // placeholder) so every "first workout of the day" lookup finds this one.
    setValues.sortOrder = 0;
  }
  // Distance/pace overrides mark the workout as hand-tuned.
  if (rest.targetKm !== undefined || paceOffsetSecKm !== undefined) {
    setValues.edited = true;
  }

  try {
    const hasOverrides = rest.targetKm !== undefined || paceOffsetSecKm !== undefined;

    // Validate overrides against the blocks BEFORE writing anything, so a bad
    // request can't leave the workout row and its blocks disagreeing.
    let blockRows: (typeof blocks.$inferSelect)[] = [];
    const blockPatches: Array<{ id: string; patch: Record<string, unknown> }> = [];
    if (hasOverrides) {
      blockRows = await db
        .select()
        .from(blocks)
        .where(eq(blocks.workoutId, workoutId));

      const plainWork = blockRows.filter(
        (b) => b.type === "work" && b.distanceKm != null && !b.reps
      );
      // Everything that can't scale is fixed: warm-up/cool-down/recovery
      // distance plus any rep-based interval km.
      const fixedKm =
        blockRows
          .filter((b) => !(b.type === "work" && b.distanceKm != null && !b.reps))
          .reduce((sum, b) => sum + (b.distanceKm ?? 0), 0) +
        blockRows.reduce(
          (sum, b) => sum + (b.reps && b.repDistanceKm ? b.reps * b.repDistanceKm : 0),
          0
        );

      if (rest.targetKm !== undefined) {
        // Distance edits only make sense when there is a plain-distance main
        // session to scale — interval sessions keep their rep structure.
        if (plainWork.length === 0) {
          return Response.json(
            { error: "This session's distance comes from its intervals — adjust pace instead." },
            { status: 422 }
          );
        }
        const minKm = Math.round((fixedKm + 0.2 * plainWork.length) * 10) / 10;
        if (rest.targetKm < minKm) {
          return Response.json(
            { error: `Too short — warm-up and cool-down alone need ${minKm} km.`, minKm },
            { status: 422 }
          );
        }

        const workKm = plainWork.reduce((sum, b) => sum + (b.distanceKm ?? 0), 0);
        const newWorkKm = rest.targetKm - fixedKm;
        const scale = newWorkKm / workKm;
        // Round per block, then push the rounding remainder onto the largest
        // block so the session always sums to the requested target.
        const scaled = plainWork.map((b) => ({
          id: b.id,
          km: Math.max(0.2, Math.round((b.distanceKm ?? 0) * scale * 10) / 10),
        }));
        const sum = scaled.reduce((acc, x) => acc + x.km, 0);
        const drift = Math.round((newWorkKm - sum) * 10) / 10;
        if (drift !== 0) {
          const largest = scaled.reduce((a, b) => (b.km > a.km ? b : a));
          largest.km = Math.max(0.2, Math.round((largest.km + drift) * 10) / 10);
        }
        for (const x of scaled) {
          blockPatches.push({ id: x.id, patch: { distanceKm: x.km } });
        }
      }

      if (paceOffsetSecKm) {
        // The offset applies uniformly or not at all — a per-field clamp would
        // be non-invertible and could collapse a pace band onto its floor.
        const paceFields = blockRows.flatMap((b) =>
          [b.targetPaceSecKm, b.minPaceSecKm, b.maxPaceSecKm].filter(
            (v): v is number => v != null
          )
        );
        const minPace = paceFields.length ? Math.min(...paceFields) : null;
        if (minPace != null && minPace + paceOffsetSecKm < 120) {
          return Response.json(
            { error: "That would push paces under 2:00/km — pick a smaller adjustment." },
            { status: 422 }
          );
        }
        for (const b of blockRows) {
          const patch: Record<string, unknown> = {};
          if (b.targetPaceSecKm != null) patch.targetPaceSecKm = b.targetPaceSecKm + paceOffsetSecKm;
          if (b.minPaceSecKm != null) patch.minPaceSecKm = b.minPaceSecKm + paceOffsetSecKm;
          if (b.maxPaceSecKm != null) patch.maxPaceSecKm = b.maxPaceSecKm + paceOffsetSecKm;
          if (Object.keys(patch).length > 0) {
            const existing = blockPatches.find((x) => x.id === b.id);
            if (existing) Object.assign(existing.patch, patch);
            else blockPatches.push({ id: b.id, patch });
          }
        }
      }
    }

    // One transaction: the workout row and its blocks change together or not
    // at all (a retried relative pace offset must never double-apply).
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(workouts)
        .set(setValues)
        .where(and(eq(workouts.id, workoutId), eq(workouts.planId, id)))
        .returning();
      if (!row) return null;
      for (const { id: blockId, patch } of blockPatches) {
        await tx.update(blocks).set(patch).where(eq(blocks.id, blockId));
      }
      return row;
    });

    if (!updated) {
      return Response.json({ error: "Workout not found" }, { status: 404 });
    }

    // Reschedule (date or a new time of day) fans out to Google Calendar
    // (same pattern as complete). A missing connection is not an error — the
    // time is still stored and shown, it just has nowhere else to sync to.
    if (date || parsed.data.timeOfDay !== undefined) {
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
    if (date) {
      // …and to the watch (self-gating: only when configured/pushed/enabled).
      queueGarminWorkoutMove(workoutId).catch((err) =>
        console.error("Failed to queue Garmin reschedule:", err)
      );
    }

    return Response.json(updated);
  } catch (err) {
    console.error("DB error updating workout:", err);
    return Response.json({ error: "Failed to update workout" }, { status: 500 });
  }
}

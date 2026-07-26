import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, weeks, workouts } from "@/db";
import { queueWorkoutSync } from "@/lib/sync/sync-manager";
import { isConnected } from "@/lib/sync/gcal-client";
import { queueGarminWorkoutMove } from "@/lib/sync/garmin-sync";

const UndoSchema = z.object({ weekId: z.string().uuid() }).strict();

// ── POST /api/plans/[id]/skip-week/undo — restore a dropped week ─────────────
//
// Restores exactly the workouts skip-week itself cancelled (from the
// snapshot), never a workout the athlete had separately marked skipped
// before or after. Re-creates their calendar/watch events the same way a
// reschedule does.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = UndoSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 422 });
  }

  try {
    const week = await db.query.weeks.findFirst({
      where: (w, { eq, and: andOp }) => andOp(eq(w.id, parsed.data.weekId), eq(w.planId, id)),
    });
    if (!week) {
      return Response.json({ error: "Week not found" }, { status: 404 });
    }
    if (!week.skippedAt) {
      return Response.json({ error: "This week isn't skipped." }, { status: 422 });
    }

    const snapshot = (week.skipSnapshot ?? []) as { id: string; status: string }[];

    await db.transaction(async (tx) => {
      for (const w of snapshot) {
        // Restore whatever status it had before (always "planned" in
        // practice, but the snapshot is authoritative, not an assumption).
        await tx
          .update(workouts)
          .set({ status: w.status as "planned", updatedAt: new Date() })
          .where(and(eq(workouts.id, w.id), eq(workouts.planId, id)));
      }
      await tx
        .update(weeks)
        .set({ skippedAt: null, skipReason: null, skipSnapshot: null })
        .where(eq(weeks.id, week.id));
    });

    // Re-create the calendar/watch events for the restored workouts.
    if (snapshot.length > 0) {
      isConnected()
        .then((connected) => {
          if (!connected) return;
          for (const w of snapshot) {
            queueWorkoutSync(w.id, "create", "gcal").catch((err) =>
              console.error("Failed to queue gcal restore:", err)
            );
          }
        })
        .catch(() => {});
      for (const w of snapshot) {
        queueGarminWorkoutMove(w.id).catch((err) =>
          console.error("Failed to queue Garmin restore:", err)
        );
      }
    }

    return Response.json({ weekId: week.id, restoredWorkoutIds: snapshot.map((w) => w.id) });
  } catch (err) {
    console.error("DB error undoing week skip:", err);
    return Response.json({ error: "Failed to undo week skip" }, { status: 500 });
  }
}

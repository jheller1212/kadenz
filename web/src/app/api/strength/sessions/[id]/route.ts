import { NextRequest } from "next/server";
import { z } from "zod";
import { eq, and, gte, lt } from "drizzle-orm";
import { db, strengthSessions, strengthSets, activities } from "@/db";
import { buildPlannedSession } from "@/lib/strength/service";
import { queueStrengthSessionSync } from "@/lib/sync/sync-manager";
import { isConnected } from "@/lib/sync/gcal-client";
import type { StrengthSessionType } from "@/lib/strength/types";

const PatchSchema = z
  .object({
    status: z.enum(["planned", "completed", "skipped", "missed"]).optional(),
    date: z.string().datetime().optional(),
    durationMinutes: z.number().int().positive().optional(),
    notes: z.string().optional(),
    sortOrder: z.number().int().optional(),
  })
  .strict();

// ── GET /api/strength/sessions/[id] ───────────────────────────────────────────
// Session with logged sets, plus the planned exercises (prescriptions,
// progression prefill, pain-gate advisory) for the logger.

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const session = await db.query.strengthSessions.findFirst({
      where: (s, { eq }) => eq(s.id, id),
      with: {
        sets: { orderBy: (st, { asc }) => [asc(st.setNumber)] },
        painLogs: true,
      },
    });
    if (!session) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }
    const plannedExercises = await buildPlannedSession(
      session.type as StrengthSessionType,
      new Date(session.date),
      session.profileId
    );

    // A linked Strava activity contributes HR + duration to the logged sets.
    const [linkedActivity] = await db
      .select({
        id: activities.id,
        stravaId: activities.stravaId,
        avgHr: activities.avgHr,
        maxHr: activities.maxHr,
        durationSeconds: activities.durationSeconds,
      })
      .from(activities)
      .where(eq(activities.strengthSessionId, id))
      .limit(1);

    return Response.json({
      ...session,
      plannedExercises,
      linkedActivity: linkedActivity ?? null,
    });
  } catch (err) {
    console.error("DB error fetching strength session:", err);
    return Response.json({ error: "Failed to fetch session" }, { status: 500 });
  }
}

// ── PATCH /api/strength/sessions/[id] ─────────────────────────────────────────
// Update status / reschedule / duration. A date or status change re-syncs the
// calendar event (the drag-and-drop fan-out).

export async function PATCH(
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

  const parsed = PatchSchema.safeParse(body);
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
    const set: Record<string, unknown> = { ...updates, updatedAt: new Date() };
    // Any hand edit adopts an auto-scheduled session — the scheduler's prune
    // must never delete something the user deliberately moved or annotated.
    set.autoScheduled = false;
    if (updates.date) {
      const d = new Date(updates.date);
      set.date = d;
      set.dayOfWeek = d.getDay();
    }

    const [updated] = await db
      .update(strengthSessions)
      .set(set)
      .where(eq(strengthSessions.id, id))
      .returning();

    // Completing a session absorbs any same-day planned twin of the same type
    // (an ad-hoc start that didn't adopt the scheduled slot, or vice versa).
    // Its sets move over, the twin is removed — no phantom "planned" leftovers
    // inflating week counts.
    if (updated && updates.status === "completed") {
      const dayStart = new Date(updated.date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const twins = await db
        .select()
        .from(strengthSessions)
        .where(
          and(
            eq(strengthSessions.type, updated.type),
            eq(strengthSessions.status, "planned"),
            gte(strengthSessions.date, dayStart),
            lt(strengthSessions.date, dayEnd)
          )
        );
      for (const twin of twins) {
        if (twin.id === updated.id) continue;
        await db
          .update(strengthSets)
          .set({ sessionId: updated.id })
          .where(eq(strengthSets.sessionId, twin.id));
        if (twin.gcalEventId) {
          isConnected()
            .then((connected) => {
              if (connected) {
                return queueStrengthSessionSync(twin.id, "delete", "gcal", {
                  gcalEventId: twin.gcalEventId,
                });
              }
            })
            .catch((err) => console.error("Failed to queue twin calendar cleanup:", err));
        }
        await db.delete(strengthSessions).where(eq(strengthSessions.id, twin.id));
      }
    }

    if (!updated) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    if (updates.date || updates.status) {
      isConnected()
        .then((connected) => {
          if (connected) {
            queueStrengthSessionSync(id, "update", "gcal").catch((err) =>
              console.error("Failed to queue strength gcal update:", err)
            );
          }
        })
        .catch(() => {});
    }

    return Response.json(updated);
  } catch (err) {
    console.error("DB error updating strength session:", err);
    return Response.json({ error: "Failed to update session" }, { status: 500 });
  }
}

// ── DELETE /api/strength/sessions/[id] ────────────────────────────────────────
// Remove a scheduled strength session and its calendar event.

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const [existing] = await db
      .select({ id: strengthSessions.id, gcalEventId: strengthSessions.gcalEventId })
      .from(strengthSessions)
      .where(eq(strengthSessions.id, id));

    if (!existing) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    await db.delete(strengthSessions).where(eq(strengthSessions.id, id));

    // Fan out the calendar deletion if there was an event.
    if (existing.gcalEventId) {
      isConnected()
        .then((connected) => {
          if (connected) {
            queueStrengthSessionSync(id, "delete", "gcal", {
              gcalEventId: existing.gcalEventId!,
            }).catch((err) =>
              console.error("Failed to queue strength gcal delete:", err)
            );
          }
        })
        .catch(() => {});
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error("DB error deleting strength session:", err);
    return Response.json({ error: "Failed to delete session" }, { status: 500 });
  }
}

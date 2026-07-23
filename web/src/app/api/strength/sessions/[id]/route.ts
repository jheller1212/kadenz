import { NextRequest } from "next/server";
import { z } from "zod";
import { eq, and, gte, lt, isNull } from "drizzle-orm";
import { db, strengthSessions, strengthSets, painLogs, activities } from "@/db";
import { buildPlannedSession, getPlanDurationMinutes } from "@/lib/strength/service";
import { clearsAutoScheduled } from "@/lib/strength/reconcile";
import { SESSION_TEMPLATES } from "@/lib/strength/program";
import { queueStrengthSessionSync } from "@/lib/sync/sync-manager";
import { queueGarminStrengthDelete, queueGarminStrengthMove } from "@/lib/sync/garmin-sync";
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
    const type = session.type as StrengthSessionType;
    // A custom-workout session (title differs from the stock template's
    // title) already carries its own real duration — never re-fit it
    // against the stock template's exercise list.
    const isCustom = session.title !== SESSION_TEMPLATES[type].title;
    // Fit to the athlete's Kraft LENGTH SETTING (30/45/60), never to the
    // session's stored targetDurationMinutes. That column holds the ESTIMATE
    // (an output); feeding it back as the fit target shrinks the session a
    // little more on every read (trim-only fit) — a slow death-spiral that made
    // the shown duration drift. The setting is the stable input.
    const fitMinutes = isCustom
      ? undefined
      : (await getPlanDurationMinutes(session.profileId)) ?? undefined;
    const { exercises: plannedExercises, estimatedDurationMinutes } =
      await buildPlannedSession(
        type,
        new Date(session.date),
        session.profileId,
        fitMinutes
      );

    // Self-heal: a session's targetDurationMinutes may still hold the
    // nominal Kraft-settings choice (30/45/60) from auto-scheduling, not the
    // real estimate of the plan actually produced — bring it in line with
    // the truth on first read so the app and Garmin push it correctly too.
    if (!isCustom && session.targetDurationMinutes !== estimatedDurationMinutes) {
      await db
        .update(strengthSessions)
        .set({ targetDurationMinutes: estimatedDurationMinutes })
        .where(eq(strengthSessions.id, id));
      session.targetDurationMinutes = estimatedDurationMinutes;
    }

    // A linked Strava activity contributes HR + duration to the logged sets.
    const [linkedActivity] = await db
      .select({
        id: activities.id,
        stravaId: activities.stravaId,
        garminId: activities.garminId,
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
    // A meaningful hand edit (date move, notes, reorder, duration) adopts an
    // auto-scheduled session — the scheduler's prune must never delete
    // something the user deliberately shaped. A bare status tick/untick is
    // NOT adoption: it must not launder auto sessions past future pruning.
    if (clearsAutoScheduled(updates)) set.autoScheduled = false;
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
            lt(strengthSessions.date, dayEnd),
            // Same athlete only — a household member's identical session must
            // never be absorbed (and its sets stolen) by someone else's tick.
            updated.profileId
              ? eq(strengthSessions.profileId, updated.profileId)
              : isNull(strengthSessions.profileId)
          )
        );
      for (const twin of twins) {
        if (twin.id === updated.id) continue;
        await db
          .update(strengthSets)
          .set({ sessionId: updated.id })
          .where(eq(strengthSets.sessionId, twin.id));
        // Pain logs cascade-delete with the session, so move them across too.
        await db
          .update(painLogs)
          .set({ sessionId: updated.id })
          .where(eq(painLogs.sessionId, twin.id));
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
      // Garmin is independent of Google Calendar: push to the watch whenever a
      // session changes (the queue self-gates on Garmin being configured), so a
      // reschedule/tick reaches the calendar immediately even without GCal.
      queueGarminStrengthMove(id).catch((err) =>
        console.error("Failed to queue Garmin strength update:", err)
      );
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
      .select({
        id: strengthSessions.id,
        gcalEventId: strengthSessions.gcalEventId,
        garminWorkoutId: strengthSessions.garminWorkoutId,
      })
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

    // ...and take it off the watch, or it lingers there after deletion here.
    if (existing.garminWorkoutId) {
      queueGarminStrengthDelete(id, existing.garminWorkoutId).catch((err) =>
        console.error("Failed to queue Garmin strength delete:", err)
      );
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error("DB error deleting strength session:", err);
    return Response.json({ error: "Failed to delete session" }, { status: 500 });
  }
}

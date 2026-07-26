import { NextRequest } from "next/server";
import { and, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { db, activities, plans, workouts, strengthSessions } from "@/db";
import { sortSessionsByDateAsc } from "@/lib/training/session";

// ── GET /api/activities/[id]/candidates ───────────────────────────────────────
// Planned run workouts and strength sessions near the activity's date that a
// recorded activity could be linked to (manual reconciliation).
// Window: ±3 days around the activity start.

const WINDOW_DAYS = 3;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const [activity] = await db
      .select()
      .from(activities)
      .where(eq(activities.id, id));
    if (!activity) {
      return Response.json({ error: "Activity not found" }, { status: 404 });
    }

    const anchor = activity.startDate ?? activity.createdAt;
    const from = new Date(anchor);
    from.setDate(from.getDate() - WINDOW_DAYS);
    from.setHours(0, 0, 0, 0);
    const to = new Date(anchor);
    to.setDate(to.getDate() + WINDOW_DAYS);
    to.setHours(23, 59, 59, 999);

    // Run workouts from the active plan (skip rest days).
    const runCandidates = await db
      .select({
        id: workouts.id,
        date: workouts.date,
        type: workouts.type,
        title: workouts.title,
        targetKm: workouts.targetKm,
        status: workouts.status,
      })
      .from(workouts)
      .innerJoin(plans, eq(workouts.planId, plans.id))
      .where(
        and(
          eq(plans.status, "active"),
          gte(workouts.date, from),
          lte(workouts.date, to),
          ne(workouts.type, "rest")
        )
      );

    // Strength sessions in the window, flagging ones already backed by
    // another recorded activity.
    const sessions = await db
      .select({
        id: strengthSessions.id,
        date: strengthSessions.date,
        type: strengthSessions.type,
        title: strengthSessions.title,
        status: strengthSessions.status,
      })
      .from(strengthSessions)
      .where(
        and(
          gte(strengthSessions.date, from),
          lte(strengthSessions.date, to),
          ne(strengthSessions.status, "skipped")
        )
      );

    let linkedSessionIds = new Set<string>();
    if (sessions.length > 0) {
      const linked = await db
        .select({ sid: activities.strengthSessionId, aid: activities.id })
        .from(activities)
        .where(inArray(activities.strengthSessionId, sessions.map((s) => s.id)));
      linkedSessionIds = new Set(
        linked.filter((l) => l.aid !== id && l.sid != null).map((l) => l.sid!)
      );
    }

    return Response.json({
      current: {
        workoutId: activity.workoutId,
        strengthSessionId: activity.strengthSessionId,
      },
      runs: sortSessionsByDateAsc(runCandidates).map((w) => ({ ...w, linked: false })),
      strength: sortSessionsByDateAsc(sessions).map((s) => ({
        ...s,
        linked: linkedSessionIds.has(s.id),
      })),
    });
  } catch (err) {
    console.error("DB error fetching link candidates:", err);
    return Response.json({ error: "Failed to fetch candidates" }, { status: 500 });
  }
}

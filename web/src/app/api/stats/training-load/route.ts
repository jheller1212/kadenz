import { z } from "zod";
import { and, eq, gte, isNotNull, ne } from "drizzle-orm";
import { db, activities, strengthSessions, strengthSets, workouts } from "@/db";
import { withSession } from "@/lib/api/with-session";
import { ownedBy } from "@/lib/api/owned";
import {
  runSessionLoad,
  strengthSessionLoad,
  weeklyLoadTrend,
  type LoadEntry,
} from "@/lib/training-load";

// ── GET /api/stats/training-load?weeks=8 ─────────────────────────────────────
// Session-RPE training load (see lib/training-load.ts) trended by week, over
// `weeks` trailing calendar weeks (Monday start) ending on the current week.
// Runs: workouts.rpe x recorded duration. Duration comes from the linked
// activity's durationSeconds (the real recorded time from Strava/Garmin sync)
// when one exists, else the guided-run player's actualDurationSeconds — never
// a planned/target duration. Strength: average RPE of a session's logged
// working sets (strength_sets.rpe, warm-ups excluded) x the session's real
// wall-clock duration (endedAt - startedAt). Either input missing means that
// session contributes nothing, not a fabricated number — see lib/training-load.ts.

const QuerySchema = z.object({
  weeks: z.coerce.number().int().min(1).max(26).default(8),
});

export const GET = withSession(async (request) => {
  const parsed = QuerySchema.safeParse({
    weeks: request.nextUrl.searchParams.get("weeks") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 }
    );
  }
  const { weeks } = parsed.data;
  const now = new Date();
  const since = new Date(now);
  since.setDate(since.getDate() - weeks * 7);

  try {
    // Completed runs in the window, with the linked activity's recorded
    // duration when a sync/import produced one.
    const runRows = await db
      .select({
        date: workouts.date,
        rpe: workouts.rpe,
        actualDurationSeconds: workouts.actualDurationSeconds,
        activityDurationSeconds: activities.durationSeconds,
      })
      .from(workouts)
      .leftJoin(activities, eq(activities.workoutId, workouts.id))
      .where(
        and(
          ownedBy(workouts),
          ne(workouts.type, "rest"),
          gte(workouts.date, since),
          isNotNull(workouts.rpe)
        )
      );

    const entries: LoadEntry[] = [];
    let runsCounted = 0;
    let runsSkipped = 0;
    for (const r of runRows) {
      const durationSeconds = r.activityDurationSeconds ?? r.actualDurationSeconds;
      const load = runSessionLoad(r.rpe, durationSeconds);
      if (load == null) {
        runsSkipped++;
        continue;
      }
      entries.push({ date: r.date, load });
      runsCounted++;
    }

    // Completed strength sessions in the window, each with its own working
    // sets (for RPE) and real start/end (for duration).
    const sessionRows = await db
      .select({
        id: strengthSessions.id,
        date: strengthSessions.date,
        startedAt: strengthSessions.startedAt,
        endedAt: strengthSessions.endedAt,
      })
      .from(strengthSessions)
      .where(and(ownedBy(strengthSessions), gte(strengthSessions.date, since)));

    let strengthCounted = 0;
    let strengthSkipped = 0;
    if (sessionRows.length > 0) {
      const setRows = await db
        .select({
          sessionId: strengthSets.sessionId,
          rpe: strengthSets.rpe,
          kind: strengthSets.kind,
        })
        .from(strengthSets)
        .innerJoin(strengthSessions, eq(strengthSets.sessionId, strengthSessions.id))
        .where(and(ownedBy(strengthSessions), gte(strengthSessions.date, since)));

      const setsBySession = new Map<string, { rpe: number | null; kind: string | null }[]>();
      for (const s of setRows) {
        const list = setsBySession.get(s.sessionId);
        if (list) list.push(s);
        else setsBySession.set(s.sessionId, [s]);
      }

      for (const session of sessionRows) {
        const sets = setsBySession.get(session.id) ?? [];
        const durationSeconds =
          session.startedAt && session.endedAt
            ? (session.endedAt.getTime() - session.startedAt.getTime()) / 1000
            : null;
        const load = strengthSessionLoad(sets, durationSeconds);
        if (load == null) {
          strengthSkipped++;
          continue;
        }
        entries.push({ date: session.date, load });
        strengthCounted++;
      }
    }

    const weekly = weeklyLoadTrend(entries, weeks, now);
    const totalLoad = entries.reduce((sum, e) => sum + e.load, 0);

    return Response.json({
      window: { weeks, from: since.toISOString(), to: now.toISOString() },
      weekly,
      totalLoad: Math.round(totalLoad),
      sessionsCounted: runsCounted + strengthCounted,
      sessionsSkipped: runsSkipped + strengthSkipped,
    });
  } catch (err) {
    console.error("Error aggregating training load:", err);
    return Response.json({ error: "Failed to aggregate" }, { status: 500 });
  }
});

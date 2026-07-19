import { NextRequest } from "next/server";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db, strengthSessions, strengthSets, strengthExercises, painLogs } from "@/db";
import { getActiveProfileId } from "@/lib/profiles";

// ── GET /api/strength/history/[exerciseId] ────────────────────────────────────
// Per-exercise chart data: top weight, total reps and estimated 1RM per
// completed session over time. For Achilles exercises, also returns the pain
// log timeline so the UI can overlay pain on the load curve.

function e1rm(weightKg: number, reps: number): number {
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10;
}

// The param accepts either the exercise UUID or its slug (the guided session
// only knows slugs).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ exerciseId: string }> }
) {
  const { exerciseId: idOrSlug } = await params;
  const profileId = getActiveProfileId(request);
  try {
    const [exercise] = await db
      .select()
      .from(strengthExercises)
      .where(
        UUID_RE.test(idOrSlug)
          ? eq(strengthExercises.id, idOrSlug)
          : eq(strengthExercises.slug, idOrSlug)
      );
    if (!exercise) {
      return Response.json({ error: "Exercise not found" }, { status: 404 });
    }
    const exerciseId = exercise.id;

    const rows = await db
      .select({
        sessionId: strengthSessions.id,
        date: strengthSessions.date,
        sessionType: strengthSessions.type,
        sessionTitle: strengthSessions.title,
        setNumber: strengthSets.setNumber,
        weightKg: strengthSets.weightKg,
        reps: strengthSets.reps,
      })
      .from(strengthSets)
      .innerJoin(strengthSessions, eq(strengthSets.sessionId, strengthSessions.id))
      .where(
        and(
          eq(strengthSets.exerciseId, exerciseId),
          eq(strengthSessions.status, "completed"),
          profileId
            ? eq(strengthSessions.profileId, profileId)
            : isNull(strengthSessions.profileId)
        )
      )
      .orderBy(asc(strengthSessions.date), asc(strengthSets.setNumber));

    // Aggregate per session.
    const bySession = new Map<
      string,
      { date: Date; topWeightKg: number; totalReps: number; bestE1rm: number }
    >();
    for (const r of rows) {
      const w = r.weightKg ?? 0;
      const reps = r.reps ?? 0;
      const cur = bySession.get(r.sessionId) ?? {
        date: new Date(r.date),
        topWeightKg: 0,
        totalReps: 0,
        bestE1rm: 0,
      };
      cur.topWeightKg = Math.max(cur.topWeightKg, w);
      cur.totalReps += reps;
      cur.bestE1rm = Math.max(cur.bestE1rm, e1rm(w, reps));
      bySession.set(r.sessionId, cur);
    }
    const points = [...bySession.values()].sort(
      (a, b) => a.date.getTime() - b.date.getTime()
    );

    // Full per-session detail (sets in order) for the exercise detail view.
    const sessionsById = new Map<
      string,
      {
        sessionId: string;
        date: Date;
        type: string;
        title: string;
        sets: Array<{ setNumber: number; weightKg: number | null; reps: number | null }>;
      }
    >();
    for (const r of rows) {
      const cur = sessionsById.get(r.sessionId) ?? {
        sessionId: r.sessionId,
        date: new Date(r.date),
        type: r.sessionType,
        title: r.sessionTitle,
        sets: [],
      };
      cur.sets.push({ setNumber: r.setNumber, weightKg: r.weightKg, reps: r.reps });
      sessionsById.set(r.sessionId, cur);
    }
    const sessions = [...sessionsById.values()].sort(
      (a, b) => a.date.getTime() - b.date.getTime()
    );

    // Pain only for THIS exercise's sessions (which are already profile-scoped
    // by the query above). The old version fetched every athlete's pain logs
    // for every exercise.
    let pain: Array<{ date: Date; score: number }> = [];
    if (exercise.category === "achilles" && sessions.length > 0) {
      const sessionIds = sessions.map((x) => x.sessionId);
      const pl = await db
        .select({ date: painLogs.createdAt, score: painLogs.score })
        .from(painLogs)
        .where(inArray(painLogs.sessionId, sessionIds))
        .orderBy(asc(painLogs.createdAt));
      pain = pl.map((p) => ({ date: p.date, score: p.score }));
    }

    return Response.json({ exercise, points, sessions, pain });
  } catch (err) {
    console.error("DB error fetching exercise history:", err);
    return Response.json({ error: "Failed to fetch history" }, { status: 500 });
  }
}

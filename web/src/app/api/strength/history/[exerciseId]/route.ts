import { NextRequest } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db, strengthSessions, strengthSets, strengthExercises, painLogs } from "@/db";

// ── GET /api/strength/history/[exerciseId] ────────────────────────────────────
// Per-exercise chart data: top weight, total reps and estimated 1RM per
// completed session over time. For Achilles exercises, also returns the pain
// log timeline so the UI can overlay pain on the load curve.

function e1rm(weightKg: number, reps: number): number {
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ exerciseId: string }> }
) {
  const { exerciseId } = await params;
  try {
    const [exercise] = await db
      .select()
      .from(strengthExercises)
      .where(eq(strengthExercises.id, exerciseId));
    if (!exercise) {
      return Response.json({ error: "Exercise not found" }, { status: 404 });
    }

    const rows = await db
      .select({
        sessionId: strengthSessions.id,
        date: strengthSessions.date,
        setNumber: strengthSets.setNumber,
        weightKg: strengthSets.weightKg,
        reps: strengthSets.reps,
      })
      .from(strengthSets)
      .innerJoin(strengthSessions, eq(strengthSets.sessionId, strengthSessions.id))
      .where(
        and(
          eq(strengthSets.exerciseId, exerciseId),
          eq(strengthSessions.status, "completed")
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

    let pain: Array<{ date: Date; score: number }> = [];
    if (exercise.category === "achilles") {
      const pl = await db
        .select({ date: painLogs.createdAt, score: painLogs.score })
        .from(painLogs)
        .orderBy(asc(painLogs.createdAt));
      pain = pl.map((p) => ({ date: p.date, score: p.score }));
    }

    return Response.json({ exercise, points, pain });
  } catch (err) {
    console.error("DB error fetching exercise history:", err);
    return Response.json({ error: "Failed to fetch history" }, { status: 500 });
  }
}

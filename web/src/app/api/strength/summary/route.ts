import { NextRequest } from "next/server";
import { and, eq, gte, isNull } from "drizzle-orm";
import { db, strengthSessions } from "@/db";
import { getActiveProfileId } from "@/lib/profiles";

// ── GET /api/strength/summary ─────────────────────────────────────────────────
// Honest, small aggregate for the Kraft hub stat row: how many completed
// sessions per week (trailing 4 weeks) and how much weight was moved this
// week (trailing 7 days). No invented numbers — both are direct sums over
// logged sets, same math as the exercise history / session-detail screens.

const FOUR_WEEKS_MS = 28 * 24 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  const profileId = getActiveProfileId(request);
  const now = new Date();
  const fourWeeksAgo = new Date(now.getTime() - FOUR_WEEKS_MS);
  const oneWeekAgo = new Date(now.getTime() - ONE_WEEK_MS);

  try {
    const profileCond = profileId
      ? eq(strengthSessions.profileId, profileId)
      : isNull(strengthSessions.profileId);

    const recentSessions = await db.query.strengthSessions.findMany({
      where: and(profileCond, eq(strengthSessions.status, "completed"), gte(strengthSessions.date, fourWeeksAgo)),
      columns: { id: true, date: true },
      with: { sets: { columns: { weightKg: true, reps: true } } },
    });

    const sessionsPerWeek = Math.round((recentSessions.length / 4) * 10) / 10;

    const volumeKg = recentSessions
      .filter((s) => s.date >= oneWeekAgo)
      .reduce(
        (sum, s) =>
          sum + s.sets.reduce((setSum, set) => setSum + (set.weightKg ?? 0) * (set.reps ?? 0), 0),
        0
      );

    return Response.json({
      sessionsPerWeek: recentSessions.length > 0 ? sessionsPerWeek : null,
      volumeKg: volumeKg > 0 ? Math.round(volumeKg) : null,
    });
  } catch (err) {
    console.error("DB error computing strength summary:", err);
    return Response.json({ error: "Failed to compute summary" }, { status: 500 });
  }
}

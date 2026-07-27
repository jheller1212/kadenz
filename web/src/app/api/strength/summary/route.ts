import { NextRequest } from "next/server";
import { and, eq, gte, isNull } from "drizzle-orm";
import { db, strengthSessions } from "@/db";
import { getActiveProfileId } from "@/lib/profiles";
import { workingVolumeKg, type SetKind } from "@/lib/strength/types";

// ── GET /api/strength/summary ─────────────────────────────────────────────────
// Honest, small aggregate for the Kraft hub stat row: how many completed
// sessions per week (trailing 4 weeks) and how much weight was moved this
// week (trailing 7 days). No invented numbers — both are direct sums over
// logged sets, via the same workingVolumeKg() helper session-detail uses, so
// a warm-up ramp can't inflate this number the way it used to.
//
// This deliberately does NOT apply pr.ts's dumbbell-count scaling: that
// scaling needs each set's exercise (to know 1 vs 2 dumbbells), which this
// route doesn't join, and the hub is a lightweight rollup, not a per-exercise
// record page. Matching session-detail's simpler number keeps the hub and the
// screen an athlete taps into it from agreeing with each other.

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
      with: { sets: { columns: { weightKg: true, reps: true, kind: true } } },
    });

    const sessionsPerWeek = Math.round((recentSessions.length / 4) * 10) / 10;

    const volumeKg = recentSessions
      .filter((s) => s.date >= oneWeekAgo)
      .reduce(
        (sum, s) =>
          sum + workingVolumeKg(s.sets.map((set) => ({ ...set, kind: set.kind as SetKind | null }))),
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

import { NextRequest } from "next/server";
import { and, eq, gte, isNull } from "drizzle-orm";
import { db, strengthSessions } from "@/db";
import { getActiveProfileId } from "@/lib/profiles";
import { sessionVolume, type VolumeSet } from "@/lib/strength/volume";

// ── GET /api/strength/summary ─────────────────────────────────────────────────
// Honest, small aggregate for the Kraft hub stat row: how many completed
// sessions per week (trailing 4 weeks) and how much weight was moved this
// week (trailing 7 days), via the same sessionVolume() helper session detail
// and exercise history use (see lib/strength/volume.ts) — a raw weightKg ×
// reps sum here used to disagree with both of those screens (no dumbbell
// scaling, bodyweight sets counted as zero). sessionVolume() excludes
// warm-up sets internally (same as it always did here), so a warm-up ramp
// still can't inflate this number.
//
// This does join each set to its exercise for the slug sessionVolume needs
// to look up the dumbbell/bodyweight profile — skipping that join used to be
// exactly how this route drifted from the other two screens. Measured: it's
// one extra indexed FK-joined column on a query that's already fetching
// every set for the trailing 4 weeks, so it's not a new round trip, just a
// wider one — no measurable added latency for the handful of sessions a week
// this route ever sees.

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
      with: {
        sets: {
          columns: { weightKg: true, reps: true, kind: true },
          with: { exercise: { columns: { slug: true } } },
        },
      },
    });

    const sessionsPerWeek = Math.round((recentSessions.length / 4) * 10) / 10;

    const setsThisWeek: VolumeSet[] = recentSessions
      .filter((s) => s.date >= oneWeekAgo)
      .flatMap((s) =>
        s.sets.map((set) => ({
          exerciseSlug: set.exercise.slug,
          weightKg: set.weightKg,
          reps: set.reps,
          kind: set.kind as "warmup" | "working" | null,
        }))
      );
    const volume = sessionVolume(setsThisWeek);

    return Response.json({
      sessionsPerWeek: recentSessions.length > 0 ? sessionsPerWeek : null,
      volumeKg: volume.kg != null ? Math.round(volume.kg) : null,
      bodyweightReps: volume.bodyweightReps,
    });
  } catch (err) {
    console.error("DB error computing strength summary:", err);
    return Response.json({ error: "Failed to compute summary" }, { status: 500 });
  }
}

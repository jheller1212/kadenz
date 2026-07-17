import { db, plans, workouts, blocks, activities, personalRecords } from "@/db";
import { eq, and, gte, or, asc, desc, inArray } from "drizzle-orm";
import { getPaceZones } from "@/lib/plan-engine/pace-zones";

// ── GET /api/pace-insights ────────────────────────────────────────────────────
// Returns pace zone data, speed/long workout history, next speed workout, and PRs

const DAY_LABELS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

const WORKOUT_COLORS: Record<string, string> = {
  tempo: "#FFB547",
  interval: "#C084FC",
};

export async function GET() {
  try {
    // ── 1. Active plan ────────────────────────────────────────────────────────
    const [activePlan] = await db
      .select({
        id: plans.id,
        name: plans.name,
        vdot: plans.vdot,
      })
      .from(plans)
      .where(eq(plans.status, "active"))
      .limit(1);

    if (!activePlan) {
      return Response.json({ activePlan: false });
    }

    const paceZones = getPaceZones(activePlan.vdot);

    // ── 2. Completed speed workouts (tempo + interval) ─────────────────────
    const completedSpeedWorkouts = await db
      .select({
        id: workouts.id,
        date: workouts.date,
        type: workouts.type,
        targetKm: workouts.targetKm,
        status: workouts.status,
      })
      .from(workouts)
      .where(
        and(
          eq(workouts.planId, activePlan.id),
          eq(workouts.status, "completed"),
          or(eq(workouts.type, "tempo"), eq(workouts.type, "interval"))
        )
      )
      .orderBy(asc(workouts.date));

    // ── 3. Completed long workouts ────────────────────────────────────────────
    const completedLongWorkouts = await db
      .select({
        id: workouts.id,
        date: workouts.date,
        type: workouts.type,
        targetKm: workouts.targetKm,
        status: workouts.status,
      })
      .from(workouts)
      .where(
        and(
          eq(workouts.planId, activePlan.id),
          eq(workouts.status, "completed"),
          eq(workouts.type, "long")
        )
      )
      .orderBy(asc(workouts.date));

    // ── 4. Fetch work blocks for all completed workouts ───────────────────────
    const allCompletedIds = [
      ...completedSpeedWorkouts.map((w) => w.id),
      ...completedLongWorkouts.map((w) => w.id),
    ];

    const workBlocks =
      allCompletedIds.length > 0
        ? await db
            .select({
              workoutId: blocks.workoutId,
              type: blocks.type,
              targetPaceSecKm: blocks.targetPaceSecKm,
              minPaceSecKm: blocks.minPaceSecKm,
              maxPaceSecKm: blocks.maxPaceSecKm,
            })
            .from(blocks)
            .where(
              and(
                inArray(blocks.workoutId, allCompletedIds),
                eq(blocks.type, "work")
              )
            )
            .orderBy(asc(blocks.sortOrder))
        : [];

    // ── 5. Fetch activities for completed workouts ────────────────────────────
    const activityRows =
      allCompletedIds.length > 0
        ? await db
            .select({
              workoutId: activities.workoutId,
              avgPaceSecKm: activities.avgPaceSecKm,
            })
            .from(activities)
            .where(inArray(activities.workoutId, allCompletedIds))
        : [];

    // Build lookup maps
    const blocksByWorkout = new Map<string, typeof workBlocks[number]>();
    for (const b of workBlocks) {
      // Use the first work block found per workout
      if (!blocksByWorkout.has(b.workoutId)) {
        blocksByWorkout.set(b.workoutId, b);
      }
    }

    const activityByWorkout = new Map<string, number | null>();
    for (const a of activityRows) {
      if (a.workoutId) {
        activityByWorkout.set(a.workoutId, a.avgPaceSecKm ?? null);
      }
    }

    // ── 6. Build speed workout data ───────────────────────────────────────────
    const speedWorkouts = completedSpeedWorkouts.map((w) => {
      const block = blocksByWorkout.get(w.id);
      const zoneKey = w.type === "tempo" ? "T" : "I";
      const zone = paceZones[zoneKey];
      return {
        date: w.date.toISOString(),
        type: w.type,
        targetPaceSecKm: block?.targetPaceSecKm ?? zone.targetPaceSecKm,
        minPaceSecKm: block?.minPaceSecKm ?? zone.minPaceSecKm,
        maxPaceSecKm: block?.maxPaceSecKm ?? zone.maxPaceSecKm,
        actualAvgPace: activityByWorkout.get(w.id) ?? null,
      };
    });

    // ── 7. Build long workout data ────────────────────────────────────────────
    const longWorkouts = completedLongWorkouts.map((w) => {
      const block = blocksByWorkout.get(w.id);
      const zone = paceZones.E;
      return {
        date: w.date.toISOString(),
        targetPaceSecKm: block?.targetPaceSecKm ?? zone.targetPaceSecKm,
        minPaceSecKm: block?.minPaceSecKm ?? zone.minPaceSecKm,
        maxPaceSecKm: block?.maxPaceSecKm ?? zone.maxPaceSecKm,
        actualAvgPace: activityByWorkout.get(w.id) ?? null,
      };
    });

    // ── 8. updatedDate: most recent completed speed or long workout ───────────
    const allCompletedDates = [
      ...completedSpeedWorkouts.map((w) => w.date),
      ...completedLongWorkouts.map((w) => w.date),
    ].sort((a, b) => b.getTime() - a.getTime());

    const updatedDate =
      allCompletedDates.length > 0
        ? allCompletedDates[0].toISOString()
        : new Date().toISOString();

    // ── 9. Next upcoming speed workout ────────────────────────────────────────
    const now = new Date();

    const [nextSpeed] = await db
      .select({
        id: workouts.id,
        date: workouts.date,
        type: workouts.type,
        targetKm: workouts.targetKm,
        dayOfWeek: workouts.dayOfWeek,
      })
      .from(workouts)
      .where(
        and(
          eq(workouts.planId, activePlan.id),
          eq(workouts.status, "planned"),
          gte(workouts.date, now),
          or(eq(workouts.type, "tempo"), eq(workouts.type, "interval"))
        )
      )
      .orderBy(asc(workouts.date))
      .limit(1);

    let nextSpeedWorkout: {
      date: string;
      dayLabel: string;
      type: string;
      targetKm: number;
      color: string;
    } | null = null;

    if (nextSpeed) {
      nextSpeedWorkout = {
        date: nextSpeed.date.toISOString(),
        dayLabel: DAY_LABELS[nextSpeed.dayOfWeek] ?? DAY_LABELS[new Date(nextSpeed.date).getDay()],
        type: nextSpeed.type,
        targetKm: nextSpeed.targetKm ?? 0,
        color: WORKOUT_COLORS[nextSpeed.type] ?? "#999",
      };
    }

    // ── 10. Personal records ──────────────────────────────────────────────────
    const prRows = await db
      .select({
        id: personalRecords.id,
        distance: personalRecords.distance,
        timeSeconds: personalRecords.timeSeconds,
        date: personalRecords.date,
        source: personalRecords.source,
      })
      .from(personalRecords)
      .orderBy(asc(personalRecords.distance));

    const raceTimes = prRows.map((pr) => ({
      id: pr.id,
      distance: pr.distance,
      timeSeconds: pr.timeSeconds,
      date: pr.date ? pr.date.toISOString() : null,
      source: pr.source,
    }));

    // ── 11. Pace status ───────────────────────────────────────────────────────
    const allCompleted = [...speedWorkouts, ...longWorkouts];

    let paceStatus: "on_point" | "ahead" | "review" | "variable" | "no_data";
    let statusMessage: string;
    let inBandPct: number | null = null;

    if (allCompleted.length === 0) {
      paceStatus = "no_data";
      statusMessage = "Complete a speed or long workout to see pace feedback.";
    } else {
      // Judge the most recent 5 completed workouts with actual pace data
      const withActual = allCompleted
        .filter((w) => w.actualAvgPace !== null)
        .slice(-5);

      if (withActual.length === 0) {
        paceStatus = "no_data";
        statusMessage = "No activity data yet. Sync your workouts to see pace feedback.";
      } else {
        // Per workout: -1 = faster than the target band, 0 = in band, 1 = slower
        const verdicts = withActual.map((w) => {
          const p = w.actualAvgPace!;
          if (p < w.minPaceSecKm) return -1;
          if (p > w.maxPaceSecKm) return 1;
          return 0;
        });
        const fast = verdicts.filter((v) => v === -1).length;
        const slow = verdicts.filter((v) => v === 1).length;
        const inBand = verdicts.length - fast - slow;
        const majority = Math.ceil(verdicts.length / 2);
        inBandPct = Math.round((inBand / verdicts.length) * 100);

        if (inBand === verdicts.length) {
          paceStatus = "on_point";
          statusMessage = "Your recent paces are within target. Keep it up!";
        } else if (fast >= majority && slow === 0) {
          paceStatus = "ahead";
          statusMessage =
            "You're consistently faster than target — your fitness may have outgrown your paces. Consider updating your race times.";
        } else if (slow >= majority && fast === 0) {
          paceStatus = "review";
          statusMessage =
            "Recent workouts came in slower than target. Occasional off days are fine — if it keeps happening, ease your goal time or check recovery.";
        } else {
          paceStatus = "variable";
          statusMessage =
            "Your paces swing both faster and slower than target. Focus on starting controlled and holding an even effort.";
        }
      }
    }

    // ── 12. Return ────────────────────────────────────────────────────────────
    return Response.json({
      activePlan: true,
      planName: activePlan.name,
      vdot: activePlan.vdot,
      updatedDate,
      paceStatus,
      statusMessage,
      inBandPct,
      nextSpeedWorkout,
      paceZones: {
        E: paceZones.E,
        T: paceZones.T,
        I: paceZones.I,
        R: paceZones.R,
      },
      speedWorkouts,
      longWorkouts,
      raceTimes,
    });
  } catch (err) {
    console.error("DB error fetching pace insights:", err);
    return Response.json({ error: "Failed to fetch pace insights" }, { status: 500 });
  }
}

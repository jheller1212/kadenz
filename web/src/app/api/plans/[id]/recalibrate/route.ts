import { NextRequest } from "next/server";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db, plans, workouts, blocks } from "@/db";
import { getCurrentFitnessEstimate } from "@/lib/current-fitness";
import { calculateVdot } from "@/lib/plan-engine/vdot";
import { getPaceZones } from "@/lib/plan-engine/pace-zones";
import { blendGoalWithCurrentFitness } from "@/lib/plan-engine/fitness-estimate";
import { planDistanceMeters } from "@/lib/plan-engine/plan-generator";
import type { PaceZones, PlanConfig } from "@/lib/plan-engine/types";
import { withSession } from "@/lib/api/with-session";
import { ownedBy, requireOwned } from "@/lib/api/owned";

const ZONE_KEYS = ["E", "M", "T", "I", "R"] as const;
type ZoneKey = (typeof ZONE_KEYS)[number];

/** Which stored pace on a block sits closest to which zone in a given set of
 *  zones — used to identify what a block's ORIGINAL pace meant before we
 *  rescale it, so a hand-adjusted or hilly-area-adjusted pace still lands in
 *  the right zone rather than being matched by absolute value alone. */
function nearestZoneKey(paces: PaceZones, referencePaceSecKm: number): ZoneKey {
  let best: ZoneKey = "E";
  let bestDiff = Infinity;
  for (const key of ZONE_KEYS) {
    const diff = Math.abs(paces[key].targetPaceSecKm - referencePaceSecKm);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = key;
    }
  }
  return best;
}

// ── POST /api/plans/[id]/recalibrate ────────────────────────────────────────
// Recomputes training paces for a plan's remaining (planned) workouts from
// the athlete's current fitness, without touching the plan's schedule, volume,
// or workout structure — only the pace numbers on each block move. Completed/
// skipped/missed workouts and the race-day workout itself are left alone: the
// first two are history, the latter is the goal the athlete is training
// toward, not a training pace to rescale.
//
// Each block is rescaled relative to the zone (E/M/T/I/R) its current pace is
// closest to, preserving any hilly-area or hand-tuned (paceOffsetSecKm)
// adjustment already baked into it — recalibrating shifts the fitness
// baseline, it doesn't undo an athlete's manual tweak.

export const POST = withSession(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;

  // Confirms ownership before anything else — this route has no body to
  // validate, but the check still comes first on principle.
  const plan = await requireOwned(plans, id);

  try {
    const estimate = await getCurrentFitnessEstimate();
    if (!estimate) {
      return Response.json(
        {
          error:
            "Not enough recent activity data to recalibrate. Sync a few runs from the last 90 days and try again.",
        },
        { status: 422 }
      );
    }

    const oldVdot = plan.vdot;
    let newVdot: number;
    if (plan.intent === "race") {
      const distM = planDistanceMeters({
        raceDistance: plan.raceDistance,
        customDistanceKm: plan.customDistanceKm,
      } as PlanConfig);
      const { vdot: goalVdot } = calculateVdot(distM, plan.goalTimeSeconds);
      newVdot = blendGoalWithCurrentFitness(goalVdot, estimate.vdot);
    } else {
      newVdot = estimate.vdot;
    }
    newVdot = Math.round(newVdot * 10) / 10;

    const oldPaces = getPaceZones(oldVdot);
    const newPaces = getPaceZones(newVdot);

    // Only planned, non-race-day workouts get their paces rescaled.
    const eligibleWorkouts = await db
      .select({ id: workouts.id })
      .from(workouts)
      .where(
        and(
          eq(workouts.planId, id),
          ownedBy(workouts),
          eq(workouts.status, "planned"),
          ne(workouts.type, "race")
        )
      );
    const workoutIds = eligibleWorkouts.map((w) => w.id);

    const blockRows = workoutIds.length
      ? await db
          .select({
            id: blocks.id,
            workoutId: blocks.workoutId,
            targetPaceSecKm: blocks.targetPaceSecKm,
            minPaceSecKm: blocks.minPaceSecKm,
            maxPaceSecKm: blocks.maxPaceSecKm,
          })
          .from(blocks)
          .where(inArray(blocks.workoutId, workoutIds))
      : [];

    const patches: Array<{ id: string; patch: Record<string, number> }> = [];
    const touchedWorkoutIds = new Set<string>();

    for (const block of blockRows) {
      const reference = block.targetPaceSecKm ?? block.minPaceSecKm ?? block.maxPaceSecKm;
      if (reference == null) continue;

      const zoneKey = nearestZoneKey(oldPaces, reference);
      const oldZone = oldPaces[zoneKey];
      const newZone = newPaces[zoneKey];

      const patch: Record<string, number> = {};
      if (block.targetPaceSecKm != null) {
        patch.targetPaceSecKm = Math.round(
          block.targetPaceSecKm * (newZone.targetPaceSecKm / oldZone.targetPaceSecKm)
        );
      }
      if (block.minPaceSecKm != null) {
        patch.minPaceSecKm = Math.round(
          block.minPaceSecKm * (newZone.minPaceSecKm / oldZone.minPaceSecKm)
        );
      }
      if (block.maxPaceSecKm != null) {
        patch.maxPaceSecKm = Math.round(
          block.maxPaceSecKm * (newZone.maxPaceSecKm / oldZone.maxPaceSecKm)
        );
      }
      if (Object.keys(patch).length > 0) {
        patches.push({ id: block.id, patch });
        touchedWorkoutIds.add(block.workoutId);
      }
    }

    await db.transaction(async (tx) => {
      await tx
        .update(plans)
        .set({ vdot: newVdot, updatedAt: new Date() })
        .where(and(eq(plans.id, id), ownedBy(plans)));
      for (const { id: blockId, patch } of patches) {
        await tx
          .update(blocks)
          .set(patch)
          .where(and(eq(blocks.id, blockId), ownedBy(blocks)));
      }
    });

    return Response.json({
      vdot: newVdot,
      previousVdot: oldVdot,
      workoutsUpdated: touchedWorkoutIds.size,
      blocksUpdated: patches.length,
      source: {
        distanceKey: estimate.source.distanceKey,
        distanceKm: Math.round(estimate.source.distanceKm * 100) / 100,
        durationSeconds: estimate.source.durationSeconds,
        date: estimate.source.date.toISOString(),
      },
    });
  } catch (err) {
    console.error("DB error recalibrating plan:", err);
    return Response.json({ error: "Failed to recalibrate plan" }, { status: 500 });
  }
});

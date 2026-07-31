import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, workouts, plans } from "@/db";
import { queueWorkoutSync } from "@/lib/sync/sync-manager";
import { isConnected } from "@/lib/sync/gcal-client";
import { withSession } from "@/lib/api/with-session";
import { currentUserId } from "@/db/with-user";
import { ownedBy, requireOwned } from "@/lib/api/owned";

// A generous ceiling (48h) rather than a race-distance-specific one — ultras
// exist, and rejecting a slow-but-real finish is worse than accepting a typo
// the athlete can fix by logging again.
const MAX_FINISH_SECONDS = 48 * 60 * 60;

const RaceResultSchema = z.object({
  finishSeconds: z.number().int().positive().max(MAX_FINISH_SECONDS),
  feel: z.string().trim().max(280).optional(),
});

// ── POST /api/workouts/[workoutId]/race-result ────────────────────────────────
// Logs the result of a race-day workout: the single most informative data
// point the athlete gives the app. Distance is already known from the plan
// (workout.targetKm), so only the finish time (and optionally how it felt)
// needs capturing.
//
// Judgement call: logging a result closes out the plan. A race plan exists
// to get the athlete to one day; once that day has a result, the plan has
// nothing left to compute (see plan-generator: the race workout is always
// the final week). "completed" (not "archived") — archived reads as
// discarded, this plan did its job. Non-race plans (get_fit/maintain) have no
// real race day and are untouched by this endpoint.
export const POST = withSession(async (
  request: NextRequest,
  { params }: { params: Promise<{ workoutId: string }> }
) => {
  const { workoutId } = await params;

  // Ownership before the body: a fake finish time posted against another
  // athlete's race workout is not a "bad request", it's a leak, and must
  // 404 regardless of whether finishSeconds parses.
  const workout = await requireOwned(workouts, workoutId);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = RaceResultSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 }
    );
  }

  try {
    if (workout.type !== "race") {
      return Response.json(
        { error: "Only the race-day workout can carry a race result" },
        { status: 422 }
      );
    }

    const now = new Date();
    const [updatedWorkout] = await db
      .update(workouts)
      .set({
        status: "completed",
        actualKm: workout.actualKm ?? workout.targetKm ?? null,
        actualDurationSeconds: parsed.data.finishSeconds,
        raceFinishSeconds: parsed.data.finishSeconds,
        raceFeel: parsed.data.feel ?? null,
        raceResultLoggedAt: now,
        updatedAt: now,
      })
      .where(and(eq(workouts.id, workoutId), ownedBy(workouts)))
      .returning();

    let planStatus: string | null = null;
    const [plan] = await db
      .select()
      .from(plans)
      .where(and(eq(plans.id, workout.planId), ownedBy(plans)));
    if (plan && plan.intent === "race" && plan.status === "active") {
      const [updatedPlan] = await db
        .update(plans)
        .set({ status: "completed", updatedAt: now })
        .where(and(eq(plans.id, plan.id), ownedBy(plans)))
        .returning({ status: plans.status });
      planStatus = updatedPlan?.status ?? null;
    } else if (plan) {
      planStatus = plan.status;
    }

    isConnected(currentUserId())
      .then((connected) => {
        if (connected) {
          queueWorkoutSync(workoutId, "update", "gcal").catch((err) => {
            console.error("Failed to queue gcal update:", err);
          });
        }
      })
      .catch(() => {});

    return Response.json({ workout: updatedWorkout, planStatus });
  } catch (err) {
    console.error("DB error logging race result:", err);
    return Response.json({ error: "Failed to log race result" }, { status: 500 });
  }
});

// ── DELETE /api/workouts/[workoutId]/race-result ──────────────────────────────
// Undo: clears the result and reopens the plan the log closed, so a mistaken
// or premature log never leaves the plan silently stuck as "completed" while
// the workout itself goes back to "planned".
export const DELETE = withSession(async (
  _request: NextRequest,
  { params }: { params: Promise<{ workoutId: string }> }
) => {
  const { workoutId } = await params;

  // The only confirmed destructive leak in this file: unscoped, this would
  // let any caller reopen and clear another athlete's logged race result.
  const workout = await requireOwned(workouts, workoutId);

  try {
    const now = new Date();
    const [updatedWorkout] = await db
      .update(workouts)
      .set({
        status: "planned",
        raceFinishSeconds: null,
        raceFeel: null,
        raceResultLoggedAt: null,
        updatedAt: now,
      })
      .where(and(eq(workouts.id, workoutId), ownedBy(workouts)))
      .returning();

    const [plan] = await db
      .select()
      .from(plans)
      .where(and(eq(plans.id, workout.planId), ownedBy(plans)));
    let planStatus: string | null = plan?.status ?? null;
    // Only reopen a plan this exact log closed — never resurrect a plan an
    // athlete deliberately archived some other way.
    if (plan && plan.status === "completed") {
      const [updatedPlan] = await db
        .update(plans)
        .set({ status: "active", updatedAt: now })
        .where(and(eq(plans.id, plan.id), ownedBy(plans)))
        .returning({ status: plans.status });
      planStatus = updatedPlan?.status ?? null;
    }

    return Response.json({ workout: updatedWorkout, planStatus });
  } catch (err) {
    console.error("DB error undoing race result:", err);
    return Response.json({ error: "Failed to undo race result" }, { status: 500 });
  }
});

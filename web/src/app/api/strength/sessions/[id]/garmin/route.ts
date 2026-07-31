import { NextRequest } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, strengthSessions, plans } from "@/db";
import { garminClient } from "@/lib/sync/garmin-client";
import { garminLabel, garminDescription, planWeekNumber } from "@/lib/sync/garmin-label";
import { withSession } from "@/lib/api/with-session";
import { ownedBy, requireOwned } from "@/lib/api/owned";

// ── POST /api/strength/sessions/[id]/garmin ───────────────────────────────────
// Push THIS session to the watch with the exact exercises the athlete just set
// up in the overview (their order, reps and loads) — so they can run it on the
// Garmin instead of the in-app guided session. Only ever creates or updates
// this session's own [kadenz]-tagged workout; it never deletes anything.

const ExerciseSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  sets: z.number().int().min(1).max(20),
  reps: z.number().int().min(1).max(100),
  weightKg: z.number().min(0).max(500).nullable(),
});

const BodySchema = z.object({
  exercises: z.array(ExerciseSchema).min(1).max(30),
});

export const POST = withSession(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;

  // requireOwned before touching Garmin at all: without this, any signed-in
  // caller who knew or guessed another athlete's session id could push that
  // session's exercises to (whoever's watch this deployment is wired to).
  const session = await requireOwned(strengthSessions, id);

  if (!garminClient.isConfigured()) {
    return Response.json({ error: "Garmin isn't connected." }, { status: 400 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    return Response.json(
      { error: "Invalid request", details: err instanceof z.ZodError ? err.issues : undefined },
      { status: 400 }
    );
  }

  // A household guest's session must never reach the owner's watch — every
  // other Garmin path (queueGarminStrengthMove, queueGarminStrengthWindowSync)
  // already filters to profileId === null; this explicit-send route talks to
  // Garmin directly and was missing the same check.
  if (session.profileId !== null) {
    return Response.json({ error: "This session can't be sent to the watch." }, { status: 403 });
  }

  // Same "W3 · Upper · Kraft · 30 min" label the background sync uses, so a
  // manual send and an auto-sync produce the identical Garmin name (and update
  // the same workout in place — no duplicate).
  const [activePlan] = await db
    .select({
      name: plans.name,
      startDate: plans.startDate,
      planLengthWeeks: plans.planLengthWeeks,
    })
    .from(plans)
    // The caller's active plan. Only used for the week number in the label, so
    // an unscoped read would have put another athlete's plan start date into
    // this athlete's watch workout title.
    .where(and(ownedBy(plans), eq(plans.status, "active")))
    .limit(1);

  const weekNumber = activePlan ? planWeekNumber(session.date, activePlan.startDate) : null;
  const workout = {
    sessionId: session.id,
    title: garminLabel(session.title, {
      weekNumber,
      metric: session.targetDurationMinutes ? `${session.targetDurationMinutes} min` : null,
    }),
    description: garminDescription({
      planName: activePlan?.name,
      weekNumber,
      totalWeeks: activePlan?.planLengthWeeks ?? null,
      body: `Strength · ${body.exercises.length} exercises${
        session.targetDurationMinutes ? ` · ~${session.targetDurationMinutes} min` : ""
      }`,
    }),
    date: session.date,
    exercises: body.exercises,
  };

  try {
    if (session.garminWorkoutId) {
      // Update this session's existing watch workout in place (keeps its id,
      // avoids a duplicate) so the loads on the wrist match what was just set.
      await garminClient.updateStrengthWorkout(session.garminWorkoutId, workout);
      return Response.json({ ok: true, garminWorkoutId: session.garminWorkoutId });
    }

    const garminWorkoutId = await garminClient.pushStrengthWorkout(workout);
    await db
      .update(strengthSessions)
      .set({ garminWorkoutId })
      .where(eq(strengthSessions.id, id));
    return Response.json({ ok: true, garminWorkoutId });
  } catch (err) {
    console.error("[strength garmin push] failed", err);
    return Response.json({ error: "Couldn't send to the watch. Try again." }, { status: 502 });
  }
});

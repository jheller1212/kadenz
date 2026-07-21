import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, strengthSessions } from "@/db";
import { garminClient } from "@/lib/sync/garmin-client";

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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

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

  const [session] = await db
    .select({
      id: strengthSessions.id,
      title: strengthSessions.title,
      date: strengthSessions.date,
      garminWorkoutId: strengthSessions.garminWorkoutId,
    })
    .from(strengthSessions)
    .where(eq(strengthSessions.id, id));

  if (!session) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  const workout = {
    sessionId: session.id,
    title: session.title,
    date: session.date,
    exercises: body.exercises,
  };

  try {
    // Confirm the Garmin session is actually usable before we try to write —
    // a token that's up but unauthenticated should read as "reconnect", not
    // a generic failure.
    if (!(await garminClient.authOk())) {
      return Response.json(
        { error: "Garmin needs reconnecting before workouts can be sent." },
        { status: 409 }
      );
    }

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
}

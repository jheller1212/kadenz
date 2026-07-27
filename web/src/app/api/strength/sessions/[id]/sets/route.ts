import { NextRequest } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db, strengthSessions, strengthSets, strengthExercises } from "@/db";
import { snapToLevel } from "@/lib/strength/weights";
import { EXERCISE_BY_SLUG } from "@/lib/strength/program";
import { isNewSingleSetRecord, type PrSet } from "@/lib/strength/pr";
import { getActiveProfileId } from "@/lib/profiles";

const SetSchema = z.object({
  exerciseId: z.string().uuid().optional(),
  exerciseSlug: z.string().optional(),
  setNumber: z.number().int().positive(),
  weightKg: z.number().nonnegative().nullable().optional(),
  reps: z.number().int().nonnegative().nullable().optional(),
  rpe: z.number().min(1).max(10).nullable().optional(),
  durationSeconds: z.number().int().nonnegative().nullable().optional(),
  // Reason chip from the "Adjust load" sheet — see schema.ts strengthSets.feel.
  feel: z.enum(["too_heavy", "easy", "niggle"]).nullable().optional(),
  // Warm-up ramp vs real working set. Absent reads as working, so older
  // clients keep behaving exactly as before. Warm-ups are excluded from the
  // progression signal (lib/strength/progression.ts workingSets).
  kind: z.enum(["warmup", "working"]).nullable().optional(),
});

// ── POST /api/strength/sessions/[id]/sets ─────────────────────────────────────
// Upsert a logged set by (session, exercise, setNumber). Weights snap to the
// dumbbell ladder server-side so history stays on real levels.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = SetSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 }
    );
  }
  const data = parsed.data;
  if (!data.exerciseId && !data.exerciseSlug) {
    return Response.json(
      { error: "exerciseId or exerciseSlug required" },
      { status: 422 }
    );
  }

  try {
    const [session] = await db
      .select({ id: strengthSessions.id })
      .from(strengthSessions)
      .where(eq(strengthSessions.id, id));
    if (!session) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    let exerciseId = data.exerciseId;
    if (!exerciseId && data.exerciseSlug) {
      const [ex] = await db
        .select({ id: strengthExercises.id })
        .from(strengthExercises)
        .where(eq(strengthExercises.slug, data.exerciseSlug));
      if (!ex) {
        return Response.json({ error: "Unknown exercise" }, { status: 422 });
      }
      exerciseId = ex.id;
    }

    const weightKg =
      data.weightKg != null && data.weightKg > 0
        ? snapToLevel(data.weightKg)
        : data.weightKg ?? null;

    // Upsert on the unique (session, exercise, setNumber) index — one
    // statement, so a queued replay racing a live write can't duplicate.
    const [row] = await db
      .insert(strengthSets)
      .values({
        sessionId: id,
        exerciseId: exerciseId!,
        setNumber: data.setNumber,
        weightKg,
        reps: data.reps ?? null,
        rpe: data.rpe ?? null,
        durationSeconds: data.durationSeconds ?? null,
        feel: data.feel ?? null,
        kind: data.kind ?? null,
      })
      .onConflictDoUpdate({
        target: [strengthSets.sessionId, strengthSets.exerciseId, strengthSets.setNumber],
        set: {
          weightKg,
          reps: data.reps ?? null,
          rpe: data.rpe ?? null,
          durationSeconds: data.durationSeconds ?? null,
          feel: data.feel ?? null,
          kind: data.kind ?? null,
        },
      })
      .returning();

    // A logged set is unambiguous proof the athlete started this session —
    // clear autoScheduled the same way a meaningful sessions PATCH does, so a
    // half-logged session is structurally no longer scheduler filler the
    // prune sweep could hard-delete out from under it (isPrunable's own
    // logged-data guard is the backstop if this ever misses).
    try {
      await db
        .update(strengthSessions)
        .set({ autoScheduled: false })
        .where(and(eq(strengthSessions.id, id), eq(strengthSessions.autoScheduled, true)));
    } catch (err) {
      console.error("Failed to clear autoScheduled after logging set:", err);
    }

    // PR check: compare this set against every other completed session that
    // logged the same exercise (the current, in-progress session is excluded
    // by the status filter, so it can never be its own prior best). See
    // lib/strength/pr.ts for the record definitions — this only decides the
    // per-set "new PR" moment; volume PRs are whole-session and surface on
    // the exercise history page instead.
    let pr = { weight: false, e1rm: false };
    try {
      const [exerciseRow] = await db
        .select({ slug: strengthExercises.slug, startWeightKg: strengthExercises.startWeightKg })
        .from(strengthExercises)
        .where(eq(strengthExercises.id, exerciseId!));
      if (exerciseRow) {
        const profileId = getActiveProfileId(request);
        const priorRows = await db
          .select({
            weightKg: strengthSets.weightKg,
            reps: strengthSets.reps,
            kind: strengthSets.kind,
          })
          .from(strengthSets)
          .innerJoin(strengthSessions, eq(strengthSets.sessionId, strengthSessions.id))
          .where(
            and(
              eq(strengthSets.exerciseId, exerciseId!),
              eq(strengthSessions.status, "completed"),
              profileId
                ? eq(strengthSessions.profileId, profileId)
                : isNull(strengthSessions.profileId)
            )
          );
        // kind feeds setType so a warm-up can never take a record.
        const priorSets: PrSet[] = priorRows.map((r) => ({
          weightKg: r.weightKg,
          reps: r.reps,
          setType: r.kind === "warmup" ? "warmup" : null,
        }));
        const catalogueEntry = EXERCISE_BY_SLUG[exerciseRow.slug];
        pr = isNewSingleSetRecord(
          {
            weightKg: row.weightKg,
            reps: row.reps,
            setType: row.kind === "warmup" ? "warmup" : null,
          },
          priorSets,
          { bodyweight: exerciseRow.startWeightKg == null, dumbbells: catalogueEntry?.dumbbells }
        );
      }
    } catch (err) {
      // PR detection is a nice-to-have on top of a set that already saved
      // successfully — never fail the save because of it.
      console.error("PR check failed:", err);
    }

    return Response.json({ ...row, pr }, { status: 201 });
  } catch (err) {
    console.error("DB error logging set:", err);
    return Response.json({ error: "Failed to log set" }, { status: 500 });
  }
}

// ── DELETE /api/strength/sessions/[id]/sets ───────────────────────────────────
// Discard a workout: remove every logged set of this session so it returns to
// its planned state.

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const [session] = await db
      .select({ id: strengthSessions.id })
      .from(strengthSessions)
      .where(eq(strengthSessions.id, id));
    if (!session) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }
    await db.delete(strengthSets).where(eq(strengthSets.sessionId, id));
    return Response.json({ ok: true });
  } catch (err) {
    console.error("DB error discarding sets:", err);
    return Response.json({ error: "Failed to discard sets" }, { status: 500 });
  }
}

import { NextRequest } from "next/server";
import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, strengthSessions, strengthSets, strengthExercises } from "@/db";
import { snapToLevel } from "@/lib/strength/weights";
import { EXERCISE_BY_SLUG } from "@/lib/strength/program";
import { isNewSingleSetRecord, type PrSet } from "@/lib/strength/pr";
import { freezeSessionComplaintsSql } from "@/lib/strength/service";
import { getVerifiedProfileId } from "@/lib/profiles";
import { withSession } from "@/lib/api/with-session";
import { ownedBy, requireOwned } from "@/lib/api/owned";

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
  // Warm-up ramp / real working set / an "extra" set logged beyond the
  // prescription / a "skipped" prescribed set the athlete finished the
  // session without logging (weightKg/reps stay null on those rows — see
  // db/schema.ts strength_sets.kind). Absent reads as working, so older
  // clients keep behaving exactly as before. Warm-ups and skipped rows are
  // excluded from the progression signal; extra rows feed it separately as
  // capacity evidence (lib/strength/progression.ts workingSets/extraSets).
  kind: z.enum(["warmup", "working", "extra", "skipped"]).nullable().optional(),
});

// ── POST /api/strength/sessions/[id]/sets ─────────────────────────────────────
// Upsert a logged set by (session, exercise, setNumber). Weights snap to the
// dumbbell ladder server-side so history stays on real levels.

export const POST = withSession(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;

  // strength_sets carries no user_id of its own — ownership resolves through
  // the parent session, checked here before the body, same reasoning as the
  // pain-log route above it.
  await requireOwned(strengthSessions, id);

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

    // Real start/end, derived from logged sets (see schema.ts strengthSessions
    // and the 0046 migration) — startedAt is set once, on the very first set;
    // endedAt keeps moving forward with every set logged, including edits to
    // an already-logged set (an upsert here is still "activity happening
    // now", the same reason an adjust-load edit resets the auto-close clock).
    // sql`coalesce` rather than a read-then-write so a queued offline replay
    // racing a live write can't clobber an earlier startedAt with a later one.
    try {
      await db
        .update(strengthSessions)
        .set({
          startedAt: sql`coalesce(${strengthSessions.startedAt}, now())`,
          endedAt: new Date(),
          // A logged set is the point where this session stops following the
          // athlete's live complaint settings and keeps what it was built
          // with, so a later settings change cannot orphan the set just
          // written (see service.ts freezeSessionComplaintsSql).
          complaints: freezeSessionComplaintsSql(),
        })
        .where(eq(strengthSessions.id, id));
    } catch (err) {
      console.error("Failed to update session start/end times after logging set:", err);
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
        const profileId = await getVerifiedProfileId(request);
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
              ownedBy(strengthSessions),
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
});

// ── DELETE /api/strength/sessions/[id]/sets ───────────────────────────────────
// No query params: discard a workout — remove every logged set of this
// session so it returns to its planned state (unchanged behaviour).
// exerciseSlug + setNumber: remove ONE set — undoing a "log one more" extra
// set the athlete added by mistake (see GuidedSession's removeLastSet /
// lib/strength/guided-sets.ts). The client only ever calls this for the last
// array position of an exercise, so setNumber always names a real, isolated
// row; nothing here re-numbers the rows around it.

const DeleteQuerySchema = z.object({
  exerciseId: z.string().uuid().optional(),
  exerciseSlug: z.string().optional(),
  setNumber: z.coerce.number().int().positive().optional(),
});

export const DELETE = withSession(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;

  // Same reasoning as POST above: strength_sets has no owner of its own, so
  // the parent session is what's checked, and it's checked before the query
  // params are validated.
  await requireOwned(strengthSessions, id);

  const url = new URL(request.url);
  const parsedQuery = DeleteQuerySchema.safeParse({
    exerciseId: url.searchParams.get("exerciseId") ?? undefined,
    exerciseSlug: url.searchParams.get("exerciseSlug") ?? undefined,
    setNumber: url.searchParams.get("setNumber") ?? undefined,
  });
  if (!parsedQuery.success) {
    return Response.json(
      { error: "Validation failed", issues: parsedQuery.error.issues },
      { status: 422 }
    );
  }
  const { exerciseId: exerciseIdParam, exerciseSlug, setNumber } = parsedQuery.data;

  try {
    if (setNumber != null && (exerciseIdParam || exerciseSlug)) {
      let exerciseId = exerciseIdParam;
      if (!exerciseId && exerciseSlug) {
        const [ex] = await db
          .select({ id: strengthExercises.id })
          .from(strengthExercises)
          .where(eq(strengthExercises.slug, exerciseSlug));
        if (!ex) {
          return Response.json({ error: "Unknown exercise" }, { status: 422 });
        }
        exerciseId = ex.id;
      }
      await db
        .delete(strengthSets)
        .where(
          and(
            eq(strengthSets.sessionId, id),
            eq(strengthSets.exerciseId, exerciseId!),
            eq(strengthSets.setNumber, setNumber)
          )
        );
      return Response.json({ ok: true });
    }

    await db.delete(strengthSets).where(eq(strengthSets.sessionId, id));
    // Discarding a workout returns it to the planned state (unchanged
    // behaviour) — its start/end derive from sets that no longer exist, so
    // they go back to null rather than lying about when it "happened".
    await db
      .update(strengthSessions)
      // Complaints go back to null with them: with no sets left there is
      // nothing to protect, and the session should track the athlete's
      // current settings again like any other planned session.
      .set({ startedAt: null, endedAt: null, complaints: null })
      .where(eq(strengthSessions.id, id));
    return Response.json({ ok: true });
  } catch (err) {
    console.error("DB error discarding sets:", err);
    return Response.json({ error: "Failed to discard sets" }, { status: 500 });
  }
});

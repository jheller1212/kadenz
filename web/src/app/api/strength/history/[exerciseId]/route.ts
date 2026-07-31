import { NextRequest } from "next/server";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, strengthSessions, strengthSets, strengthExercises, painLogs } from "@/db";
import { getVerifiedProfileId } from "@/lib/profiles";
import { EXERCISE_BY_SLUG, movementFamilySlugs } from "@/lib/strength/program";
import { computeSessionMetrics, annotatePrs, currentRecords, type PrSet } from "@/lib/strength/pr";
import { withSession } from "@/lib/api/with-session";
import { ownedBy } from "@/lib/api/owned";

// ── GET /api/strength/history/[exerciseId] ────────────────────────────────────
// Per-exercise chart data: PR-annotated metrics per completed session over
// time (heaviest set, estimated 1RM, session volume — see lib/strength/pr.ts
// for the record definitions, including bodyweight and per-hand handling).
// For Achilles exercises, also returns the pain log timeline so the UI can
// overlay pain on the load curve.

// The param accepts either the exercise UUID or its slug (the guided session
// only knows slugs).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withSession(async (
  request: NextRequest,
  { params }: { params: Promise<{ exerciseId: string }> }
) => {
  const { exerciseId: idOrSlug } = await params;
  const profileId = await getVerifiedProfileId(request);
  try {
    const [exercise] = await db
      .select()
      .from(strengthExercises)
      .where(
        UUID_RE.test(idOrSlug)
          ? eq(strengthExercises.id, idOrSlug)
          : eq(strengthExercises.slug, idOrSlug)
      );
    if (!exercise) {
      return Response.json({ error: "Exercise not found" }, { status: 404 });
    }
    const exerciseId = exercise.id;

    const rows = await db
      .select({
        sessionId: strengthSessions.id,
        date: strengthSessions.date,
        sessionType: strengthSessions.type,
        sessionTitle: strengthSessions.title,
        setNumber: strengthSets.setNumber,
        weightKg: strengthSets.weightKg,
        reps: strengthSets.reps,
        kind: strengthSets.kind,
      })
      .from(strengthSets)
      .innerJoin(strengthSessions, eq(strengthSets.sessionId, strengthSessions.id))
      .where(
        and(
          ownedBy(strengthSessions),
          eq(strengthSets.exerciseId, exerciseId),
          eq(strengthSessions.status, "completed"),
          profileId
            ? eq(strengthSessions.profileId, profileId)
            : isNull(strengthSessions.profileId)
        )
      )
      .orderBy(asc(strengthSessions.date), asc(strengthSets.setNumber));

    // Full per-session detail (sets in order) for the exercise detail view.
    const sessionsById = new Map<
      string,
      {
        sessionId: string;
        date: Date;
        type: string;
        title: string;
        sets: Array<{
          setNumber: number;
          weightKg: number | null;
          reps: number | null;
          kind: string | null;
        }>;
      }
    >();
    for (const r of rows) {
      const cur = sessionsById.get(r.sessionId) ?? {
        sessionId: r.sessionId,
        date: new Date(r.date),
        type: r.sessionType,
        title: r.sessionTitle,
        sets: [],
      };
      cur.sets.push({
        setNumber: r.setNumber,
        weightKg: r.weightKg,
        reps: r.reps,
        kind: r.kind,
      });
      sessionsById.set(r.sessionId, cur);
    }
    const sessionsChrono = [...sessionsById.values()].sort(
      (a, b) => a.date.getTime() - b.date.getTime()
    );

    // PR detection (lib/strength/pr.ts): the catalogue's startWeightKg tells
    // us this exercise is bodyweight; the catalogue's dumbbells count (not
    // persisted on strength_exercises) scales the volume figure for
    // two-dumbbell lifts. strength_sets.kind is the setType tag (mapped to
    // PrSet.setType just below) so warm-up sets are excluded; anything else
    // is treated as a working set (see pr.ts module note).
    const catalogueEntry = EXERCISE_BY_SLUG[exercise.slug];
    const profile = {
      bodyweight: exercise.startWeightKg == null,
      dumbbells: catalogueEntry?.dumbbells,
    };
    const metricsChrono = sessionsChrono.map((s) =>
      computeSessionMetrics(
        // Warm-ups are excluded from every record (see lib/strength/pr.ts).
        s.sets.map((set): PrSet => ({
          weightKg: set.weightKg,
          reps: set.reps,
          setType: set.kind === "warmup" ? "warmup" : null,
        })),
        s.sessionId,
        s.date,
        profile
      )
    );
    const annotated = annotatePrs(metricsChrono);
    const records = currentRecords(metricsChrono);

    // Legacy point shape (topWeightKg/bestE1rm per session), kept for any
    // caller that reads it directly instead of `sessions`.
    const points = metricsChrono.map((m) => ({
      date: m.date,
      topWeightKg: m.topWeightKg,
      bestE1rm: m.bestE1rm,
    }));

    const sessions = sessionsChrono.map((s, i) => ({
      ...s,
      pr: annotated[i].pr,
    }));

    // Pain only for THIS exercise's sessions (which are already profile-scoped
    // by the query above). The old version fetched every athlete's pain logs
    // for every exercise.
    let pain: Array<{ date: Date; score: number }> = [];
    if (exercise.category === "achilles" && sessions.length > 0) {
      const sessionIds = sessions.map((x) => x.sessionId);
      const pl = await db
        .select({ date: painLogs.createdAt, score: painLogs.score })
        .from(painLogs)
        .where(inArray(painLogs.sessionId, sessionIds))
        .orderBy(asc(painLogs.createdAt));
      pain = pl.map((p) => ({ date: p.date, score: p.score }));
    }

    // Display-only "last done" across every equipment variant of the same
    // movement (see movementFamilySlugs) — a per-session equipment override
    // can resolve the squat slot to db_squat one day and air_squat the next,
    // and an athlete calling both "squats" should see the more recent one
    // instead of a stale date from the last time THIS exact slug came up.
    // Never used for load prefill or PRs (those stay exact-slug, above) —
    // a barbell number and a dumbbell number aren't interchangeable.
    const family = movementFamilySlugs(exercise.slug);
    let familyLast: {
      exerciseSlug: string;
      exerciseName: string;
      date: Date;
      sets: Array<{ setNumber: number; weightKg: number | null; reps: number | null; kind: string | null }>;
    } | null = null;
    if (family.length > 1) {
      const familyRows = await db
        .select({
          sessionId: strengthSessions.id,
          date: strengthSessions.date,
          slug: strengthExercises.slug,
          exerciseName: strengthExercises.name,
          setNumber: strengthSets.setNumber,
          weightKg: strengthSets.weightKg,
          reps: strengthSets.reps,
          kind: strengthSets.kind,
        })
        .from(strengthSets)
        .innerJoin(strengthSessions, eq(strengthSets.sessionId, strengthSessions.id))
        .innerJoin(strengthExercises, eq(strengthSets.exerciseId, strengthExercises.id))
        .where(
          and(
            ownedBy(strengthSessions),
            inArray(strengthExercises.slug, family),
            eq(strengthSessions.status, "completed"),
            profileId
              ? eq(strengthSessions.profileId, profileId)
              : isNull(strengthSessions.profileId)
          )
        )
        .orderBy(desc(strengthSessions.date), asc(strengthSets.setNumber));

      if (familyRows.length > 0) {
        const topSessionId = familyRows[0].sessionId;
        familyLast = {
          exerciseSlug: familyRows[0].slug,
          exerciseName: familyRows[0].exerciseName,
          date: familyRows[0].date,
          sets: familyRows
            .filter((r) => r.sessionId === topSessionId)
            .map((r) => ({ setNumber: r.setNumber, weightKg: r.weightKg, reps: r.reps, kind: r.kind })),
        };
      }
    }

    return Response.json({
      exercise,
      bodyweight: profile.bodyweight,
      points,
      sessions,
      records,
      pain,
      familyLast,
    });
  } catch (err) {
    console.error("DB error fetching exercise history:", err);
    return Response.json({ error: "Failed to fetch history" }, { status: 500 });
  }
});

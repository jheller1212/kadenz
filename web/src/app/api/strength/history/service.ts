import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, strengthSessions, strengthSets, strengthExercises, painLogs } from "@/db";
import { ownedBy } from "@/lib/api/owned";
import { EXERCISE_BY_SLUG, movementFamilySlugs } from "@/lib/strength/program";
import { computeSessionMetrics, annotatePrs, currentRecords, type PrSet } from "@/lib/strength/pr";

// ── Shared by /api/strength/history/[exerciseId] and /api/strength/history/list ──
//
// getExerciseHistory is the single definition of "one exercise's PR-annotated
// session history" — the detail route below and the exercise-detail screen
// both call it, unchanged from before this file existed.
//
// listExerciseHistories is the answer to a different question (every
// exercise's sparkline data, for the history list screen) and used to be
// answered by calling the endpoint above once per catalogue exercise — up to
// ~100 parallel serverless invocations for one screen. It is not built by
// looping getExerciseHistory in a for loop, which would still be ~100 round
// trips, just serial ones inside a single function instead of 100 functions.
// It runs the join ONCE across every exercise and folds the PR math (from
// lib/strength/pr.ts, the same functions getExerciseHistory calls) in memory,
// so the request is two queries total regardless of catalogue size.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ExerciseHistoryResult {
  exercise: typeof strengthExercises.$inferSelect;
  bodyweight: boolean;
  points: Array<{ date: Date; topWeightKg: number; bestE1rm: number }>;
  sessions: Array<{
    sessionId: string;
    date: Date;
    type: string;
    title: string;
    sets: Array<{ setNumber: number; weightKg: number | null; reps: number | null; kind: string | null }>;
    pr: { weight: boolean; e1rm: boolean; volume: boolean };
  }>;
  records: ReturnType<typeof currentRecords>;
  pain: Array<{ date: Date; score: number }>;
  familyLast: {
    exerciseSlug: string;
    exerciseName: string;
    date: Date;
    sets: Array<{ setNumber: number; weightKg: number | null; reps: number | null; kind: string | null }>;
  } | null;
}

/** One exercise's full chart + session-log detail. Returns null if the exercise (by id or slug) doesn't exist. */
export async function getExerciseHistory(
  idOrSlug: string,
  profileId: string | null
): Promise<ExerciseHistoryResult | null> {
  const [exercise] = await db
    .select()
    .from(strengthExercises)
    .where(
      UUID_RE.test(idOrSlug)
        ? eq(strengthExercises.id, idOrSlug)
        : eq(strengthExercises.slug, idOrSlug)
    );
  if (!exercise) return null;
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

  const sessionsById = new Map<
    string,
    {
      sessionId: string;
      date: Date;
      type: string;
      title: string;
      sets: Array<{ setNumber: number; weightKg: number | null; reps: number | null; kind: string | null }>;
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
    cur.sets.push({ setNumber: r.setNumber, weightKg: r.weightKg, reps: r.reps, kind: r.kind });
    sessionsById.set(r.sessionId, cur);
  }
  const sessionsChrono = [...sessionsById.values()].sort((a, b) => a.date.getTime() - b.date.getTime());

  const catalogueEntry = EXERCISE_BY_SLUG[exercise.slug];
  const profile = {
    bodyweight: exercise.startWeightKg == null,
    dumbbells: catalogueEntry?.dumbbells,
  };
  const metricsChrono = sessionsChrono.map((s) =>
    computeSessionMetrics(
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

  const points = metricsChrono.map((m) => ({ date: m.date, topWeightKg: m.topWeightKg, bestE1rm: m.bestE1rm }));
  const sessions = sessionsChrono.map((s, i) => ({ ...s, pr: annotated[i].pr }));

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

  const family = movementFamilySlugs(exercise.slug);
  let familyLast: ExerciseHistoryResult["familyLast"] = null;
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

  return { exercise, bodyweight: profile.bodyweight, points, sessions, records, pain, familyLast };
}

// ── List summary (sparkline screen) ─────────────────────────────────────────

export interface ExerciseHistorySummary {
  exercise: { id: string; slug: string; name: string; category: string };
  points: Array<{ date: Date; topWeightKg: number; bestE1rm: number }>;
  pain: Array<{ date: Date; score: number }>;
}

/**
 * Every exercise's sparkline history in one pass: one join across every
 * completed session's sets (not filtered to a single exercise, unlike
 * getExerciseHistory above), grouped and folded through the same PR math in
 * memory, plus one batched pain-log query for the achilles-tracked ones.
 * Two queries total, not one per exercise.
 */
export async function listExerciseHistories(profileId: string | null): Promise<ExerciseHistorySummary[]> {
  const rows = await db
    .select({
      exerciseId: strengthSets.exerciseId,
      exerciseSlug: strengthExercises.slug,
      exerciseName: strengthExercises.name,
      exerciseCategory: strengthExercises.category,
      startWeightKg: strengthExercises.startWeightKg,
      sessionId: strengthSessions.id,
      date: strengthSessions.date,
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
        eq(strengthSessions.status, "completed"),
        profileId
          ? eq(strengthSessions.profileId, profileId)
          : isNull(strengthSessions.profileId)
      )
    )
    .orderBy(asc(strengthSessions.date), asc(strengthSets.setNumber));

  interface ExGroup {
    slug: string;
    name: string;
    category: string;
    startWeightKg: number | null;
    sessions: Map<
      string,
      { sessionId: string; date: Date; sets: Array<{ weightKg: number | null; reps: number | null; kind: string | null }> }
    >;
  }
  const byExercise = new Map<string, ExGroup>();
  for (const r of rows) {
    let group = byExercise.get(r.exerciseId);
    if (!group) {
      group = {
        slug: r.exerciseSlug,
        name: r.exerciseName,
        category: r.exerciseCategory,
        startWeightKg: r.startWeightKg,
        sessions: new Map(),
      };
      byExercise.set(r.exerciseId, group);
    }
    let session = group.sessions.get(r.sessionId);
    if (!session) {
      session = { sessionId: r.sessionId, date: new Date(r.date), sets: [] };
      group.sessions.set(r.sessionId, session);
    }
    session.sets.push({ weightKg: r.weightKg, reps: r.reps, kind: r.kind });
  }

  const results: ExerciseHistorySummary[] = [];
  // sessionId -> exerciseId, scoped to achilles exercises only, so the one
  // batched pain query below can be routed back to the exercise it belongs to.
  const achillesSessionIds: string[] = [];
  const sessionIdToExercise = new Map<string, string>();

  for (const [exerciseId, group] of byExercise) {
    const sessionsChrono = [...group.sessions.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
    const catalogueEntry = EXERCISE_BY_SLUG[group.slug];
    const profile = {
      bodyweight: group.startWeightKg == null,
      dumbbells: catalogueEntry?.dumbbells,
    };
    const metricsChrono = sessionsChrono.map((s) =>
      computeSessionMetrics(
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
    const points = metricsChrono.map((m) => ({ date: m.date, topWeightKg: m.topWeightKg, bestE1rm: m.bestE1rm }));

    if (group.category === "achilles") {
      for (const s of sessionsChrono) {
        achillesSessionIds.push(s.sessionId);
        sessionIdToExercise.set(s.sessionId, exerciseId);
      }
    }

    results.push({
      exercise: { id: exerciseId, slug: group.slug, name: group.name, category: group.category },
      points,
      pain: [],
    });
  }

  if (achillesSessionIds.length > 0) {
    const pl = await db
      .select({ sessionId: painLogs.sessionId, date: painLogs.createdAt, score: painLogs.score })
      .from(painLogs)
      .where(inArray(painLogs.sessionId, achillesSessionIds))
      .orderBy(asc(painLogs.createdAt));

    const painByExercise = new Map<string, Array<{ date: Date; score: number }>>();
    for (const p of pl) {
      const exerciseId = sessionIdToExercise.get(p.sessionId);
      if (!exerciseId) continue;
      const arr = painByExercise.get(exerciseId) ?? [];
      arr.push({ date: p.date, score: p.score });
      painByExercise.set(exerciseId, arr);
    }
    for (const r of results) {
      const arr = painByExercise.get(r.exercise.id);
      if (arr) r.pain = arr;
    }
  }

  return results;
}

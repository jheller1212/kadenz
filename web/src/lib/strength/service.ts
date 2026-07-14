import { and, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import {
  db,
  plans,
  strengthExercises,
  strengthPlanSettings,
  strengthSessions,
  strengthSets,
  painLogs,
} from "@/db";
import { buildSessionPlan, type PlannedExercise } from "./session";
import { evaluatePainGate, type PainGateResult } from "./progression";
import { EXERCISES } from "./program";
import type {
  ExerciseSessionHistory,
  StrengthSessionType,
  LoggedSet,
} from "./types";

// ── Server-side helpers shared by the strength API routes ─────────────────────

/** 1-based program week for a date, from the active plan's start date. */
export async function getProgramWeek(date: Date): Promise<number> {
  const [plan] = await db
    .select({ startDate: plans.startDate })
    .from(plans)
    .where(eq(plans.status, "active"))
    .limit(1);
  if (!plan) return 1;
  const start = new Date(plan.startDate);
  start.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((d.getTime() - start.getTime()) / 86_400_000);
  return Math.max(1, Math.floor(diffDays / 7) + 1);
}

/**
 * Completed-session history per exercise slug, newest-first, for sessions
 * strictly before `before`. Used to prefill loads and drive progression.
 */
export async function getExerciseHistoryBySlug(
  before: Date,
  profileId: string | null = null
): Promise<Record<string, ExerciseSessionHistory[]>> {
  const rows = await db
    .select({
      sessionId: strengthSessions.id,
      date: strengthSessions.date,
      slug: strengthExercises.slug,
      setNumber: strengthSets.setNumber,
      weightKg: strengthSets.weightKg,
      reps: strengthSets.reps,
      rpe: strengthSets.rpe,
    })
    .from(strengthSets)
    .innerJoin(strengthSessions, eq(strengthSets.sessionId, strengthSessions.id))
    .innerJoin(strengthExercises, eq(strengthSets.exerciseId, strengthExercises.id))
    .where(
      and(
        eq(strengthSessions.status, "completed"),
        lte(strengthSessions.date, before),
        // Prefill loads only from the same person's history.
        profileId
          ? eq(strengthSessions.profileId, profileId)
          : isNull(strengthSessions.profileId)
      )
    )
    .orderBy(desc(strengthSessions.date));

  const bySlug: Record<string, Map<string, ExerciseSessionHistory>> = {};
  for (const r of rows) {
    if (new Date(r.date) >= before) continue;
    const slugMap = (bySlug[r.slug] ??= new Map());
    let sess = slugMap.get(r.sessionId);
    if (!sess) {
      sess = { sessionId: r.sessionId, date: new Date(r.date), sets: [] };
      slugMap.set(r.sessionId, sess);
    }
    const set: LoggedSet = {
      setNumber: r.setNumber,
      weightKg: r.weightKg,
      reps: r.reps,
      rpe: r.rpe,
    };
    sess.sets.push(set);
  }

  const out: Record<string, ExerciseSessionHistory[]> = {};
  for (const [slug, map] of Object.entries(bySlug)) {
    out[slug] = [...map.values()].sort((a, b) => b.date.getTime() - a.date.getTime());
  }
  return out;
}

/** Evaluate the Achilles pain gate from recent pain logs (last `days`). */
export async function getPainGate(
  before: Date,
  days = 10
): Promise<PainGateResult> {
  const since = new Date(before);
  since.setDate(since.getDate() - days);
  const logs = await db
    .select({
      score: painLogs.score,
      timing: painLogs.timing,
      settledWithin24h: painLogs.settledWithin24h,
    })
    .from(painLogs)
    .where(and(gte(painLogs.createdAt, since), lte(painLogs.createdAt, before)));
  return evaluatePainGate(logs);
}

/** Build the planned exercises for a session, with prefill + gate context. */
export async function buildPlannedSession(
  type: StrengthSessionType,
  date: Date,
  profileId: string | null = null
): Promise<PlannedExercise[]> {
  const [programWeek, historyBySlug, painGate, ability] = await Promise.all([
    getProgramWeek(date),
    getExerciseHistoryBySlug(date, profileId),
    getPainGate(date),
    getAbility(profileId),
  ]);
  return buildSessionPlan(type, { programWeek, historyBySlug, painGate, ability });
}

/** Strength ability from the weekly-plan wizard settings, if configured. */
async function getAbility(
  profileId: string | null
): Promise<"beginner" | "intermediate" | "advanced" | undefined> {
  const [row] = await db
    .select({ ability: strengthPlanSettings.ability })
    .from(strengthPlanSettings)
    .where(
      profileId
        ? eq(strengthPlanSettings.profileId, profileId)
        : isNull(strengthPlanSettings.profileId)
    );
  const a = row?.ability;
  return a === "beginner" || a === "intermediate" || a === "advanced"
    ? a
    : undefined;
}

/** Map exercise slugs → ids (seeded catalogue). */
export async function getExerciseIdMap(): Promise<Record<string, string>> {
  const rows = await db
    .select({ id: strengthExercises.id, slug: strengthExercises.slug })
    .from(strengthExercises);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.slug] = r.id;
  return map;
}

/** Slugs present in a session type's template, in order. */
export function templateSlugs(type: StrengthSessionType): string[] {
  return buildSessionPlan(type).map((p) => p.slug);
}

export { EXERCISES, inArray };

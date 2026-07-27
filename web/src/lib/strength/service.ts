import { and, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import {
  db,
  plans,
  strengthExercises,
  strengthPlanSettings,
  strengthSessions,
  strengthSets,
  painLogs,
  weeks,
} from "@/db";
import {
  buildSessionPlan,
  estimateSessionMinutes,
  applyExerciseOverrides,
  type PlannedExercise,
  type ExerciseOverride,
} from "./session";
import { evaluatePainGate, type PainGateResult } from "./progression";
import { EXERCISES } from "./program";
import { EQUIPMENT_KEYS } from "./equipment";
import type { LifterProfile } from "./load-model";
import type {
  Complaint,
  Equipment,
  ExerciseSessionHistory,
  StrengthSessionType,
  LoggedSet,
} from "./types";
import { STRENGTH_COMPLAINTS } from "./types";

// ── Server-side helpers shared by the strength API routes ─────────────────────

/** 1-based week number for a date, counting from a plan's start date. */
function weekNumberFor(date: Date, startDate: Date): number {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((d.getTime() - start.getTime()) / 86_400_000);
  return Math.max(1, Math.floor(diffDays / 7) + 1);
}

/**
 * The active running plan's id + start date, or null with no active plan.
 * Both the program week and the week's phase info derive from this same row
 * — fetched once and reused, rather than each querying `plans` on its own
 * (they used to, doubling a round trip that costs real latency over the pooled
 * connection on every planned-session build).
 */
async function getActivePlanRef(): Promise<{ id: string; startDate: Date } | null> {
  const [plan] = await db
    .select({ id: plans.id, startDate: plans.startDate })
    .from(plans)
    .where(eq(plans.status, "active"))
    .limit(1);
  return plan ?? null;
}

/**
 * Program week + week phase info (base/build/peak/taper, normal/deload/race
 * — drives the strength set-count backoff in phase-policy.ts) together, from
 * a single active-plan lookup instead of two separate ones against `plans`
 * (see getActivePlanRef). Null weekInfo with no active plan: a standalone
 * strength block has no phase concept and its sessions are left exactly as
 * their template/ability prescribes (see schedule.ts's `block` branch, which
 * never touches this).
 */
async function getProgramWeekAndPhase(
  date: Date
): Promise<{ programWeek: number; weekInfo: { phase: string; type: string } | null }> {
  const plan = await getActivePlanRef();
  if (!plan) return { programWeek: 1, weekInfo: null };
  const weekNumber = weekNumberFor(date, plan.startDate);
  const [week] = await db
    .select({ phase: weeks.phase, type: weeks.type })
    .from(weeks)
    .where(and(eq(weeks.planId, plan.id), eq(weeks.weekNumber, weekNumber)));
  return { programWeek: weekNumber, weekInfo: week ?? null };
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
      kind: strengthSets.kind,
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
      // Carried through so progression can exclude warm-ups. Null reads as
      // working, which is what every pre-existing row is.
      kind: r.kind === "warmup" ? "warmup" : null,
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

export interface PlannedSessionResult {
  exercises: PlannedExercise[];
  /** Real-world estimate (minutes) of the plan actually produced — this is
   *  the truth that should be written back to a session's
   *  `targetDurationMinutes`, not the nominal duration that was requested. */
  estimatedDurationMinutes: number;
}

/**
 * Build the planned exercises for a session, with prefill + gate context.
 *
 * `targetDurationMinutes`, when given, is the athlete's chosen session
 * length (Kraft settings: 30/45/60 min) — the plan is reshaped to fit it
 * (see duration-fit.ts) rather than always producing the template's fixed
 * nominal-length plan regardless of what was chosen.
 */
export async function buildPlannedSession(
  type: StrengthSessionType,
  date: Date,
  profileId: string | null = null,
  targetDurationMinutes?: number,
  exerciseOverrides: ExerciseOverride[] = [],
  // Callers that already fetched the settings row for their own purposes
  // (e.g. the duration to fit against) pass it through here so this doesn't
  // hit `strength_plan_settings` a second time for the same profile — see
  // getStrengthPlanSettingsRow. `undefined` (not passed) means "fetch it";
  // `null` explicitly means "known absent, don't bother querying".
  preloadedSettingsRow?: PlanSettingsRow | null
): Promise<PlannedSessionResult> {
  const [{ programWeek, weekInfo }, historyBySlug, painGate, settingsRow] = await Promise.all([
    getProgramWeekAndPhase(date),
    getExerciseHistoryBySlug(date, profileId),
    getPainGate(date),
    preloadedSettingsRow !== undefined
      ? Promise.resolve(preloadedSettingsRow)
      : getStrengthPlanSettingsRow(profileId),
  ]);
  const planSettings = derivePlanSettingsForLoads(settingsRow);
  const plan = buildSessionPlan(type, {
    programWeek,
    historyBySlug,
    painGate,
    ability: planSettings.ability,
    lifterProfile: planSettings.lifterProfile,
    complaints: planSettings.complaints,
    targetDurationMinutes,
    restSecondsOverride: planSettings.restSeconds,
    equipment: planSettings.equipment,
    weekInfo,
  });
  // Hand edits (Exchange / Remove) layered on last — see session.ts for why
  // these can't be baked into the template-derived plan itself.
  const exercises = applyExerciseOverrides(plan, exerciseOverrides, {
    historyBySlug,
    lifterProfile: planSettings.lifterProfile,
  });
  return { exercises, estimatedDurationMinutes: estimateSessionMinutes(exercises) };
}

/** Raw `strength_plan_settings` row shape shared by duration lookups and
 *  load-model derivation — fetched once per request and reused, see
 *  getStrengthPlanSettingsRow. */
export interface PlanSettingsRow {
  durationMinutes: number | null;
  ability: string | null;
  bodyweightKg: number | null;
  sex: string | null;
  complaints: string[] | null;
  restSeconds: number | null;
  equipment: string[] | null;
}

/**
 * The full `strength_plan_settings` row for a profile in one query — every
 * column any caller in this file needs. Callers that used to run a narrow
 * `getPlanDurationMinutes` query and then hand off to `buildPlannedSession`
 * (which queried the same table again for the rest of the columns) now fetch
 * this once and pass it straight through instead.
 */
export async function getStrengthPlanSettingsRow(
  profileId: string | null
): Promise<PlanSettingsRow | null> {
  const [row] = await db
    .select({
      durationMinutes: strengthPlanSettings.durationMinutes,
      ability: strengthPlanSettings.ability,
      bodyweightKg: strengthPlanSettings.bodyweightKg,
      sex: strengthPlanSettings.sex,
      complaints: strengthPlanSettings.complaints,
      restSeconds: strengthPlanSettings.restSeconds,
      equipment: strengthPlanSettings.equipment,
    })
    .from(strengthPlanSettings)
    .where(
      profileId
        ? eq(strengthPlanSettings.profileId, profileId)
        : isNull(strengthPlanSettings.profileId)
    );
  return row ?? null;
}

/** The athlete's chosen Kraft session length (30/45/60 min), if configured. */
export function planDurationMinutesFromRow(row: PlanSettingsRow | null): number | undefined {
  return row?.durationMinutes ?? undefined;
}

/**
 * Ability + cold-start load inputs from the weekly-plan wizard settings, if
 * configured. `ability` doubles as lifting experience for the load model.
 * Pure derivation from an already-fetched row — see getStrengthPlanSettingsRow.
 */
function derivePlanSettingsForLoads(row: PlanSettingsRow | null): {
  ability: "beginner" | "intermediate" | "advanced" | undefined;
  lifterProfile: LifterProfile | null;
  complaints: Complaint[];
  restSeconds: number | null;
  /** Available equipment (Kraft setup); null = not configured yet — every
   *  session slot keeps its base exercise, unfiltered (see session.ts). */
  equipment: Equipment[] | null;
} {
  const a = row?.ability;
  const ability =
    a === "beginner" || a === "intermediate" || a === "advanced" ? a : undefined;
  const sex =
    row?.sex === "male" || row?.sex === "female" || row?.sex === "unspecified"
      ? row.sex
      : undefined;
  const complaintSet = new Set<string>(STRENGTH_COMPLAINTS);
  const complaints = (row?.complaints ?? []).filter((c): c is Complaint =>
    complaintSet.has(c)
  );
  const equipmentKeySet = new Set<string>(EQUIPMENT_KEYS);
  const equipment = row?.equipment
    ? row.equipment.filter((e): e is Equipment => equipmentKeySet.has(e))
    : null;
  return {
    ability,
    lifterProfile: row
      ? { bodyweightKg: row.bodyweightKg, sex, experience: ability }
      : null,
    complaints,
    restSeconds: row?.restSeconds ?? null,
    equipment,
  };
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
export type { ExerciseOverride };

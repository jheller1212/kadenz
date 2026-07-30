import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
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
  applyExerciseOrder,
  type PlannedExercise,
  type ExerciseOverride,
} from "./session";
import { evaluatePainGate, type PainGateResult } from "./progression";
import { EXERCISES } from "./program";
import { achillesProgramWeek, effectiveComplaints } from "./complaint-work";
import { EQUIPMENT_KEYS } from "./equipment";
import type { LifterProfile } from "./load-model";
import type {
  Complaint,
  Equipment,
  ExerciseSessionHistory,
  Goal,
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
 *
 * `equipmentOverride`, when given (not `undefined`), replaces the profile's
 * stored equipment for THIS call only — the profile's own
 * `strength_plan_settings.equipment` is never read or written here. Used for
 * a session-level "I'm at the gym today" override (see the sessions POST/GET
 * routes) without mutating the athlete's default equipment.
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
  preloadedSettingsRow?: PlanSettingsRow | null,
  equipmentOverride?: Equipment[] | null,
  // The session's stored exercise order (strengthSessions.exerciseOrder), if
  // the athlete set one. Applied last, after the template plan and the hand
  // edits, so it reorders exactly the list the athlete will see. Reordering
  // never changes the duration estimate below (it sums per-exercise costs),
  // so it is safe to apply after duration-fit has already run.
  exerciseOrder?: string[] | null,
  // The complaint set this session was started with
  // (strengthSessions.complaints, migration 0062). Complaints are a template
  // input, so a still-planned session (undefined/null here) follows whatever
  // the athlete currently reports and picks up a settings change for free. A
  // session the athlete has already started keeps what it was built with, so
  // turning a complaint off never rebuilds a session whose sets are already
  // logged against the work that complaint added.
  complaintsSnapshot?: string[] | null
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
  const complaints = effectiveComplaints(
    complaintsSnapshot ? filterComplaints(complaintsSnapshot) : null,
    planSettings.complaints
  );
  const plan = buildSessionPlan(type, {
    // The HSR ramp runs on its own clock (when the Achilles complaint was
    // reported), not the running plan's week — see complaint-work.ts.
    programWeek: complaints.includes("achilles")
      ? achillesProgramWeek(settingsRow?.achillesStartedAt ?? null, date, programWeek)
      : programWeek,
    historyBySlug,
    painGate,
    ability: planSettings.ability,
    lifterProfile: planSettings.lifterProfile,
    complaints,
    targetDurationMinutes,
    restSecondsOverride: planSettings.restSeconds,
    equipment: equipmentOverride !== undefined ? equipmentOverride : planSettings.equipment,
    goal: planSettings.goal,
    weekInfo,
  });
  // Hand edits (Exchange / Remove) layered on last — see session.ts for why
  // these can't be baked into the template-derived plan itself.
  const edited = applyExerciseOverrides(plan, exerciseOverrides, {
    historyBySlug,
    lifterProfile: planSettings.lifterProfile,
  });
  // The athlete's own order last of all — see session.ts applyExerciseOrder.
  const exercises = applyExerciseOrder(edited, exerciseOrder);
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
  achillesStartedAt: Date | null;
  restSeconds: number | null;
  equipment: string[] | null;
  goal: string | null;
}

/** Stored complaint strings → the Complaint values the engine understands.
 *  Anything unrecognised (an old value, a hand-edited row) is dropped rather
 *  than shaping a session off a complaint no template knows about. */
function filterComplaints(raw: string[]): Complaint[] {
  const known = new Set<string>(STRENGTH_COMPLAINTS);
  return raw.filter((c): c is Complaint => known.has(c));
}

/**
 * SQL for `strength_sessions.complaints` that freezes the profile's current
 * complaints onto a session the first time it is written, and leaves an
 * already-frozen value alone.
 *
 * Written at the moment a session stops being hypothetical (first logged set,
 * or a status change away from "planned"). Before that the column stays null
 * and the session follows the athlete's live settings, which is what makes
 * turning a complaint off reshape everything still to come. After it, the
 * session renders from what it was built with, so its logged sets always
 * belong to an exercise the plan still lists (see migration 0062).
 *
 * A correlated subquery rather than a read-then-write so an offline replay
 * racing a live write cannot overwrite the frozen set with a later one.
 */
export function freezeSessionComplaintsSql() {
  return sql`coalesce(${strengthSessions.complaints}, (
    select coalesce(ps.${sql.identifier("complaints")}, array[]::text[])
    from ${strengthPlanSettings} ps
    where ps.${sql.identifier("profile_id")} is not distinct from ${strengthSessions.profileId}
    limit 1
  ), array[]::text[])`;
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
      achillesStartedAt: strengthPlanSettings.achillesStartedAt,
      restSeconds: strengthPlanSettings.restSeconds,
      equipment: strengthPlanSettings.equipment,
      goal: strengthPlanSettings.goal,
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
  /** Strength goal (Kraft setup); undefined = not configured yet, same as
   *  "all_round" (no set-count adjustment) — see session.ts buildSessionPlan. */
  goal: Goal | undefined;
} {
  const a = row?.ability;
  const ability =
    a === "beginner" || a === "intermediate" || a === "advanced" ? a : undefined;
  const sex =
    row?.sex === "male" || row?.sex === "female" || row?.sex === "unspecified"
      ? row.sex
      : undefined;
  const complaints = filterComplaints(row?.complaints ?? []);
  const equipmentKeySet = new Set<string>(EQUIPMENT_KEYS);
  const equipment = row?.equipment
    ? row.equipment.filter((e): e is Equipment => equipmentKeySet.has(e))
    : null;
  const goal: Goal | undefined =
    row?.goal === "running_focus" || row?.goal === "all_round" ? row.goal : undefined;
  return {
    ability,
    lifterProfile: row
      ? { bodyweightKg: row.bodyweightKg, sex, experience: ability }
      : null,
    complaints,
    restSeconds: row?.restSeconds ?? null,
    equipment,
    goal,
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

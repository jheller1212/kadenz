import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db, plans, strengthPlanSettings, strengthSessions, weeks, workouts } from "@/db";
import { queueStrengthSessionSync } from "@/lib/sync/sync-manager";
import { queueGarminStrengthDelete } from "@/lib/sync/garmin-sync";
import { blockEndDate, blockWeekBudget, blockWeekNumber } from "./block";
import { isConnected } from "@/lib/sync/gcal-client";
import { SESSION_TEMPLATES } from "./program";
import type { PlacementDay } from "./schedule-place";
import {
  computeTopUpPlacements,
  rotationFor,
  weekBudgetFor,
  dateFromDayKey,
  isPrunable,
  weekKeyOf,
} from "./reconcile";
import type { Complaint, StrengthSessionType } from "./types";

// ── Weekly strength scheduler ────────────────────────────────────────────────
// Tops up planned strength sessions for the next two weeks from the profile's
// wizard settings. Idempotent: one session per calendar day; existing sessions
// (manual or auto) block a slot; pruning only touches future auto-scheduled
// sessions the user never edited (a meaningful PATCH — date move, notes,
// reorder — clears the auto flag; a bare status tick does not).
//
// Day math runs in the household timezone — the server is UTC and naive
// startOfDay would put late-evening sessions on the wrong calendar day.

// Fallback horizon when there is no running plan to follow.
const HORIZON_DAYS = 14;
// Safety rail: never schedule further out than this even for a long plan.
const MAX_HORIZON_DAYS = 200;
const APP_TZ = "Europe/Amsterdam";

// Session-type rotation selection (rotationFor) lives in reconcile.ts, the
// pure DB-free module, so it stays unit-testable without a database.

/** Calendar-day key ("2026-07-14") of a timestamp in the household TZ. */
function dayKey(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: APP_TZ });
}

/** 0=Sun … 6=Sat of a timestamp in the household TZ. */
function dowInTz(d: Date): number {
  const name = d.toLocaleDateString("en-US", { timeZone: APP_TZ, weekday: "short" });
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

export async function ensureStrengthSchedule(profileId: string | null) {
  const [settings] = await db
    .select()
    .from(strengthPlanSettings)
    .where(
      profileId
        ? eq(strengthPlanSettings.profileId, profileId)
        : isNull(strengthPlanSettings.profileId)
    );
  if (!settings || !settings.active) return { created: 0 };

  const complaints = ((settings.complaints ?? []) as Complaint[]).filter(Boolean);
  const rotation = rotationFor(settings.goal, settings.sessionsPerWeek, complaints);

  // Anchor at noon UTC — a timestamp whose calendar day is identical in UTC
  // and any European timezone, so stored dates can't drift across midnight.
  const now = new Date();
  const anchor = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0
  ));
  // Strength follows the running plan: schedule the whole block, not a
  // rolling fortnight, so an athlete can see the full commitment up front.
  const [activePlan] = await db
    .select({ id: plans.id, raceDate: plans.raceDate, startDate: plans.startDate })
    .from(plans)
    .where(eq(plans.status, "active"))
    .limit(1);

  // Without a running plan, a standalone block supplies the structure.
  const block =
    !activePlan && settings.blockWeeks && settings.blockStartDate
      ? { weeks: settings.blockWeeks, start: settings.blockStartDate }
      : null;

  const daysToRace = activePlan
    ? Math.ceil(
        (activePlan.raceDate.getTime() - anchor.getTime()) / (24 * 60 * 60 * 1000)
      )
    : 0;
  const daysToBlockEnd = block
    ? Math.ceil(
        (blockEndDate(block.start, block.weeks).getTime() - anchor.getTime()) /
          (24 * 60 * 60 * 1000)
      )
    : 0;
  const horizonDays = Math.min(
    MAX_HORIZON_DAYS,
    Math.max(HORIZON_DAYS, daysToRace, daysToBlockEnd)
  );

  const horizon = new Date(anchor);
  horizon.setUTCDate(horizon.getUTCDate() + horizonDays + 1);

  // Week types drive the load: no strength in race week, one less in a
  // deload or taper week.
  const planWeeks = activePlan
    ? await db
        .select({ weekNumber: weeks.weekNumber, type: weeks.type, phase: weeks.phase })
        .from(weeks)
        .where(eq(weeks.planId, activePlan.id))
    : [];
  // Weeks carry only their number, so derive each one's Monday from the plan's
  // own start — the same alignment the plan generator uses.
  const weekTypeByKey = new Map<string, { type: string; phase: string }>();
  if (activePlan) {
    const planMonday = dateFromDayKey(weekKeyOf(dayKey(activePlan.startDate)));
    for (const w of planWeeks) {
      const monday = new Date(planMonday);
      monday.setUTCDate(monday.getUTCDate() + (w.weekNumber - 1) * 7);
      weekTypeByKey.set(weekKeyOf(dayKey(monday)), { type: w.type, phase: w.phase });
    }
  }
  const weekBudget = (weekKey: string, rotationLength: number): number => {
    if (block) {
      // A block has its own shape: deload every fourth week, and nothing
      // scheduled once it ends.
      const monday = dateFromDayKey(weekKey);
      return blockWeekBudget(
        blockWeekNumber(monday, block.start, block.weeks),
        block.weeks,
        rotationLength
      );
    }
    return weekBudgetFor(weekTypeByKey.get(weekKey), rotationLength);
  };
  // Query back to the Monday of the current week: sessions already done or
  // planned earlier this week must count against this week's cap even though
  // they sit before the top-up strip.
  const windowStart = dateFromDayKey(weekKeyOf(dayKey(anchor)));
  windowStart.setUTCDate(windowStart.getUTCDate() - 1); // TZ slack

  // Existing sessions in the window (any status, any origin) block their
  // calendar day and count against their calendar week's session budget.
  const existing = await db
    .select({ date: strengthSessions.date })
    .from(strengthSessions)
    .where(
      and(
        gte(strengthSessions.date, windowStart),
        lte(strengthSessions.date, horizon),
        profileId
          ? eq(strengthSessions.profileId, profileId)
          : isNull(strengthSessions.profileId)
      )
    );
  const taken = new Set(existing.map((s) => dayKey(s.date)));
  const sessionsByWeek = new Map<string, number>();
  for (const s of existing) {
    const wk = weekKeyOf(dayKey(s.date));
    sessionsByWeek.set(wk, (sessionsByWeek.get(wk) ?? 0) + 1);
  }

  // Run schedule in the window (owner's active plan) — the placement engine
  // keeps heavy leg work off hard-run days and the day before.
  const runByDay = new Map<string, string>();
  if (!profileId) {
    const runs = await db
      .select({ date: workouts.date, type: workouts.type })
      .from(workouts)
      .innerJoin(plans, eq(workouts.planId, plans.id))
      .where(
        and(
          eq(plans.status, "active"),
          gte(workouts.date, windowStart),
          lte(workouts.date, horizon)
        )
      );
    for (const r of runs) {
      if (r.type !== "rest") runByDay.set(dayKey(r.date), r.type);
    }
  }

  const gcal = !profileId ? await isConnected().catch(() => false) : false;

  // Build the day strip (tomorrow → horizon); the pure planner cuts it into
  // Monday weeks and enforces the per-day and per-week caps.
  const strip: Array<PlacementDay & { date: Date }> = [];
  for (let offset = 1; offset <= horizonDays; offset++) {
    const day = new Date(anchor);
    day.setUTCDate(day.getUTCDate() + offset);
    const key = dayKey(day);
    const nextDay = new Date(day);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    strip.push({
      key,
      date: day,
      dow: dowInTz(day),
      runType: runByDay.get(key) ?? null,
      nextDayRunType: runByDay.get(dayKey(nextDay)) ?? null,
      taken: taken.has(key),
    });
  }

  const placements = computeTopUpPlacements(
    strip,
    rotation,
    settings.availableDays,
    sessionsByWeek,
    weekBudget
  );

  let created = 0;
  for (const placement of placements) {
    const day = strip.find((d) => d.key === placement.key)!;
    const template = SESSION_TEMPLATES[placement.type];
    const [row] = await db
      .insert(strengthSessions)
      .values({
        profileId,
        date: day.date,
        dayOfWeek: day.dow,
        type: placement.type,
        title: template.title,
        status: "planned",
        targetDurationMinutes: settings.durationMinutes,
        autoScheduled: true,
      })
      .onConflictDoNothing()
      .returning({ id: strengthSessions.id });
    if (row) {
      created++;
      if (gcal) {
        queueStrengthSessionSync(row.id, "create", "gcal").catch(() => {});
      }
    }
  }

  return { created };
}

/** Remove future auto-scheduled sessions the user never touched. */
export async function pruneAutoSchedule(profileId: string | null) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const candidates = await db
    .select({
      id: strengthSessions.id,
      gcalEventId: strengthSessions.gcalEventId,
      garminWorkoutId: strengthSessions.garminWorkoutId,
      date: strengthSessions.date,
      status: strengthSessions.status,
      autoScheduled: strengthSessions.autoScheduled,
    })
    .from(strengthSessions)
    .where(
      and(
        gte(strengthSessions.date, today),
        profileId
          ? eq(strengthSessions.profileId, profileId)
          : isNull(strengthSessions.profileId)
      )
    );
  // The selection contract lives in one tested predicate: future + planned +
  // auto-scheduled only; completed and hand-touched sessions are permanent.
  const future = candidates.filter((s) => isPrunable(s, today));
  if (future.length === 0) return { removed: 0 };

  // Calendar events and watch workouts must go with their rows or they
  // linger forever on services the user can't clean up from here.
  for (const s of future) {
    if (s.gcalEventId) {
      await queueStrengthSessionSync(s.id, "delete", "gcal", {
        gcalEventId: s.gcalEventId,
      }).catch(() => {});
    }
    if (s.garminWorkoutId) {
      await queueGarminStrengthDelete(s.id, s.garminWorkoutId).catch(() => {});
    }
  }

  await db
    .delete(strengthSessions)
    .where(inArray(strengthSessions.id, future.map((s) => s.id)));
  return { removed: future.length };
}

/**
 * Prune-then-top-up in one shot. Run after a plan is created or regenerated —
 * strength sessions have no plan FK, so the old plan's future auto-scheduled
 * sessions would otherwise linger while the scheduler adds new ones on top.
 * Also safe standalone (the reconcile route) to clean up an existing mess.
 */
export async function reconcileStrengthSchedule(profileId: string | null) {
  const { removed } = await pruneAutoSchedule(profileId);
  const { created } = await ensureStrengthSchedule(profileId);
  return { removed, created };
}

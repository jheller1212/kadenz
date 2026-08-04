import { and, eq, gte, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import {
  db,
  plans,
  strengthPlanSettings,
  strengthSessions,
  strengthSets,
  painLogs,
  weeks,
  workouts,
} from "@/db";
import { ownedBy } from "@/lib/api/owned";
import { currentUserId } from "@/db/with-user";
import { asUserId } from "@/lib/user-id";
import { queueStrengthSessionSync } from "@/lib/sync/sync-manager";
import { queueGarminStrengthDelete, queueGarminStrengthMove } from "@/lib/sync/garmin-sync";
import { blockEndDate, blockWeekBudget, blockWeekNumber } from "./block";
import { isConnected } from "@/lib/sync/gcal-client";
import { ACHILLES_SESSION_TYPES, SESSION_TEMPLATES } from "./program";
import { buildPlannedSession } from "./service";
import type { PlacementDay } from "./schedule-place";
import {
  computeAchillesRehabDays,
  computeTopUpPlacements,
  rotationFor,
  weekBudgetFor,
  dateFromDayKey,
  isPrunable,
  isStaleAdhoc,
  isAutoCloseDue,
  autoCloseUpdate,
  weekKeyOf,
} from "./reconcile";
import type { Complaint, StrengthSessionType } from "./types";
import { timer } from "@/lib/timing";

// Plain rotation types — the only ones the Achilles rehab pass ever attaches
// its block to (the dedicated achilles/lower_achilles/upper_achilles types
// always carry it on their own).
const PLAIN_STRENGTH_TYPES = new Set<StrengthSessionType>(["upper", "lower", "full_body"]);

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

export async function ensureStrengthSchedule(profileId: string | null, userId: string) {
  // Branded once here: the sync queue functions require a validated UserId
  // (see lib/user-id.ts) rather than an arbitrary string.
  const uid = asUserId(userId);
  const [settings] = await db
    .select()
    .from(strengthPlanSettings)
    .where(
      and(
        ownedBy(strengthPlanSettings),
        profileId
          ? eq(strengthPlanSettings.profileId, profileId)
          : isNull(strengthPlanSettings.profileId)
      )
    );
  if (!settings || !settings.active) return { created: 0, shortWeeks: 0 };

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
  // The extra columns feed the Achilles rehab pass below: which days already
  // carry the block (type, achillesAttached), and which existing rows are
  // safe to retroactively attach/detach it on (status, autoScheduled,
  // startedAt — never a session the athlete has already started).
  const existing = await db
    .select({
      id: strengthSessions.id,
      date: strengthSessions.date,
      type: strengthSessions.type,
      status: strengthSessions.status,
      autoScheduled: strengthSessions.autoScheduled,
      startedAt: strengthSessions.startedAt,
      achillesAttached: strengthSessions.achillesAttached,
    })
    .from(strengthSessions)
    .where(
      and(
        ownedBy(strengthSessions),
        gte(strengthSessions.date, windowStart),
        lte(strengthSessions.date, horizon),
        profileId
          ? eq(strengthSessions.profileId, profileId)
          : isNull(strengthSessions.profileId)
      )
    );
  const taken = new Set(existing.map((s) => dayKey(s.date)));
  const sessionsByWeek = new Map<string, number>();
  const existingByKey = new Map<string, (typeof existing)[number]>();
  for (const s of existing) {
    const key = dayKey(s.date);
    const wk = weekKeyOf(key);
    sessionsByWeek.set(wk, (sessionsByWeek.get(wk) ?? 0) + 1);
    existingByKey.set(key, s);
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

  const gcal = !profileId ? await isConnected(userId).catch(() => false) : false;

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
    weekBudget,
    complaints
  );

  // ── Achilles/HSR rehab: a frequency-and-spacing policy over the whole
  // week, not a placement pass restricted to days the strength rotation left
  // free (see reconcile.ts computeAchillesRehabDays for the full reasoning —
  // this is the fix for the bug that produced ZERO rehab exposures for an
  // athlete whose strength rotation already filled every available day).
  //
  // Decide the rehab DAYS first, over the athlete's whole available week —
  // `dayTypeMap` tells the day-picker which days already carry the block
  // (existing achilles-carrying rows, or an existing plain session with
  // achillesAttached already true — encoded as the "achilles" sentinel so
  // it's skipped the same way a dedicated type is) so it never double-picks
  // a day that's already covered, but every other day — including ones the
  // strength rotation just claimed or already held a plain session — stays a
  // real candidate.
  const stripKeys = new Set(strip.map((d) => d.key));
  const dayTypeMap = new Map<string, StrengthSessionType>();
  for (const [key, row] of existingByKey) {
    const type = row.type as StrengthSessionType;
    const alreadyCarrying = ACHILLES_SESSION_TYPES.has(type) || row.achillesAttached;
    dayTypeMap.set(key, alreadyCarrying ? "achilles" : type);
  }
  for (const p of placements) {
    if (!dayTypeMap.has(p.key)) dayTypeMap.set(p.key, p.type);
  }

  let rehabDays = new Set<string>();
  if (complaints.includes("achilles")) {
    const achillesWeeklyCounts = new Map<string, number>();
    let lastAchillesKeyBeforeStrip: string | null = null;
    const firstStripKey = strip[0]?.key;
    for (const [key, row] of existingByKey) {
      const type = row.type as StrengthSessionType;
      if (!ACHILLES_SESSION_TYPES.has(type) && !row.achillesAttached) continue;
      achillesWeeklyCounts.set(weekKeyOf(key), (achillesWeeklyCounts.get(weekKeyOf(key)) ?? 0) + 1);
      if (
        firstStripKey != null &&
        key < firstStripKey &&
        (lastAchillesKeyBeforeStrip == null || key > lastAchillesKeyBeforeStrip)
      ) {
        lastAchillesKeyBeforeStrip = key;
      }
    }
    rehabDays = new Set(
      computeAchillesRehabDays(
        strip,
        dayTypeMap,
        settings.availableDays,
        achillesWeeklyCounts,
        lastAchillesKeyBeforeStrip
      )
    );
  }

  // Every chosen rehab day either already has (or is about to get, via
  // `placements` above) a plain session — attach the block to it — or is
  // genuinely free, and becomes its own standalone "achilles" session.
  // `computeAchillesRehabDays` never returns a day already covered by
  // `dayTypeMap`'s "achilles" sentinel, so every key here is either a plain
  // type or genuinely absent.
  const freshPlacementKeys = new Set(placements.map((p) => p.key));
  const attachAchillesKeys = new Set<string>();
  const standaloneAchillesDays: string[] = [];
  for (const key of rehabDays) {
    if (freshPlacementKeys.has(key) || existingByKey.has(key)) {
      attachAchillesKeys.add(key);
    } else {
      standaloneAchillesDays.push(key);
    }
  }

  // A week can legitimately place fewer sessions than its budget: the
  // placement engine drops a slot rather than break a hard rule (heavy legs
  // on/before a hard run day, race-day blackout). That's a real constraint,
  // not a bug, but it must not go unnoticed — count it here from the same
  // budget math the engine used, so the caller (plan creation) can tell the
  // athlete honestly instead of quietly handing them a thin week.
  const placedByWeek = new Map<string, number>();
  for (const p of placements) {
    const wk = weekKeyOf(p.key);
    placedByWeek.set(wk, (placedByWeek.get(wk) ?? 0) + 1);
  }
  const weekKeysInStrip = [...new Set(strip.map((d) => weekKeyOf(d.key)))];
  let shortWeeks = 0;
  for (const wk of weekKeysInStrip) {
    const already = sessionsByWeek.get(wk) ?? 0;
    const budget = weekBudget(wk, rotation.length);
    const target = Math.max(0, Math.min(budget, rotation.length) - already);
    if ((placedByWeek.get(wk) ?? 0) < target) shortWeeks++;
  }

  // Store the plan's REAL fitted estimate — not the nominal chosen length — so
  // Today/Kraft show the same duration the session actually is (a 45-min
  // setting whose fit only fills ~33 min must read 33, not 45). The duration
  // varies by session type AND by whether Achilles/HSR work is attached (an
  // attached "lower" session runs longer than a plain one), so the memo key
  // is a compound of both instead of type alone.
  //
  // The dedicated Achilles session never takes the athlete's general
  // session-length preference (settings.durationMinutes) — it's a fixed,
  // dose-specific rehab protocol (SESSION_TIME_TARGETS.achilles, ~20 min),
  // not a flexible workout to stretch or shrink to a chosen length. Omitting
  // a target duration entirely (undefined) leaves buildSessionPlan's
  // duration-fit step untouched, so it keeps the template's own prescription.
  // An attached plain session keeps fitting to the athlete's chosen length as
  // before — the same "duration-fit trims accessory work first, never the
  // Achilles-role block" protection (duration-fit.ts) that the historic
  // upper_achilles/lower_achilles combo types already relied on.
  const durationByKey = new Map<string, number>();
  async function estimatedMinutesFor(
    type: StrengthSessionType,
    date: Date,
    attached: boolean = false
  ): Promise<number> {
    const cacheKey = `${type}:${attached}`;
    const cached = durationByKey.get(cacheKey);
    if (cached != null) return cached;
    const { estimatedDurationMinutes } = await buildPlannedSession(
      type,
      date,
      profileId,
      type === "achilles" ? undefined : settings.durationMinutes,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      attached
    );
    durationByKey.set(cacheKey, estimatedDurationMinutes);
    return estimatedDurationMinutes;
  }

  let created = 0;
  for (const placement of placements) {
    const day = strip.find((d) => d.key === placement.key)!;
    const template = SESSION_TEMPLATES[placement.type];
    const attached = attachAchillesKeys.has(placement.key);
    const [row] = await db
      .insert(strengthSessions)
      .values({
        userId: currentUserId(),
        profileId,
        date: day.date,
        dayOfWeek: day.dow,
        type: placement.type,
        title: template.title,
        status: "planned",
        targetDurationMinutes: await estimatedMinutesFor(placement.type, day.date, attached),
        autoScheduled: true,
        achillesAttached: attached,
        // Scheduler placements are always part of the plan — eligible for
        // automatic Garmin delivery (see schema.ts watchEligible).
        watchEligible: true,
      })
      .onConflictDoNothing()
      .returning({ id: strengthSessions.id });
    if (row) {
      created++;
      if (gcal) {
        queueStrengthSessionSync(row.id, "create", uid, "gcal").catch(() => {});
      }
    }
  }

  // Standalone Achilles days: nothing else was scheduled that day, so the
  // rehab work gets its own session (the dedicated "achilles" type) instead
  // of being attached to anything.
  const achillesTemplate = SESSION_TEMPLATES.achilles;
  for (const key of standaloneAchillesDays) {
    const day = strip.find((d) => d.key === key)!;
    const [row] = await db
      .insert(strengthSessions)
      .values({
        userId: currentUserId(),
        profileId,
        date: day.date,
        dayOfWeek: day.dow,
        type: "achilles",
        title: achillesTemplate.title,
        status: "planned",
        targetDurationMinutes: await estimatedMinutesFor("achilles", day.date),
        autoScheduled: true,
        watchEligible: true,
      })
      .onConflictDoNothing()
      .returning({ id: strengthSessions.id });
    if (row) {
      created++;
      if (gcal) {
        queueStrengthSessionSync(row.id, "create", uid, "gcal").catch(() => {});
      }
    }
  }

  // Reconcile Achilles attachment on EXISTING plain-type sessions still in
  // the strip (never a day before tomorrow, and never a session the athlete
  // already started or hand-touched — same "frozen once real" boundary as
  // everywhere else in this file) so the weekly rehab-day decision reaches
  // sessions that were already on the calendar before this run, in both
  // directions: attaching where a day newly became a rehab day, and
  // detaching where it no longer is (complaint turned off, or the pattern
  // shifted) — a settings change reaching everything still to come, not just
  // brand-new placements.
  for (const [key, existingRow] of existingByKey) {
    if (!stripKeys.has(key)) continue; // never touch today or the past
    const type = existingRow.type as StrengthSessionType;
    if (!PLAIN_STRENGTH_TYPES.has(type)) continue;
    if (
      !existingRow.autoScheduled ||
      existingRow.status !== "planned" ||
      existingRow.startedAt != null
    ) {
      continue;
    }
    const desired = attachAchillesKeys.has(key);
    if (existingRow.achillesAttached === desired) continue;
    const est = await estimatedMinutesFor(type, dateFromDayKey(key), desired);
    await db
      .update(strengthSessions)
      .set({ achillesAttached: desired, targetDurationMinutes: est })
      .where(eq(strengthSessions.id, existingRow.id));
    // Same reasoning as the duration heal below: the exercise list changed,
    // so the watch/calendar copies need re-pushing, not just the in-app view.
    queueGarminStrengthMove(existingRow.id).catch(() => {});
    if (gcal) {
      queueStrengthSessionSync(existingRow.id, "update", uid, "gcal").catch(() => {});
    }
  }

  // Heal existing near-term auto sessions whose stored duration predates this
  // estimate (created before this fix, or after a settings/estimator change),
  // so the Today and week views stop showing a stale number. Bounded to the
  // next 4 weeks — the range those screens actually display — and the estimate
  // is memoised, so this is a handful of reads plus updates only where changed.
  const healEnd = new Date(anchor);
  healEnd.setUTCDate(healEnd.getUTCDate() + 28);
  const nearTerm = await db
    .select({
      id: strengthSessions.id,
      type: strengthSessions.type,
      date: strengthSessions.date,
      targetDurationMinutes: strengthSessions.targetDurationMinutes,
      achillesAttached: strengthSessions.achillesAttached,
    })
    .from(strengthSessions)
    .where(
      and(
        ownedBy(strengthSessions),
        profileId
          ? eq(strengthSessions.profileId, profileId)
          : isNull(strengthSessions.profileId),
        eq(strengthSessions.status, "planned"),
        eq(strengthSessions.autoScheduled, true),
        gte(strengthSessions.date, anchor),
        lte(strengthSessions.date, healEnd)
      )
    );
  for (const s of nearTerm) {
    const est = await estimatedMinutesFor(s.type as StrengthSessionType, s.date, s.achillesAttached);
    if (s.targetDurationMinutes !== est) {
      await db
        .update(strengthSessions)
        .set({ targetDurationMinutes: est })
        .where(eq(strengthSessions.id, s.id));
      // The estimate drives the pushed prescriptions too — the watch label
      // ("… · 30 min") and the calendar event. Re-queue them so a rest/setting
      // change reaches Garmin and Google Calendar, not just the in-app view.
      // Both queues self-gate on being configured/connected, so this is a
      // no-op when an integration is off.
      queueGarminStrengthMove(s.id).catch(() => {});
      if (gcal) {
        queueStrengthSessionSync(s.id, "update", uid, "gcal").catch(() => {});
      }
    }
  }

  return { created, shortWeeks };
}

/**
 * Re-push every still-planned session in the next four weeks to the calendar
 * and the watch.
 *
 * ensureStrengthSchedule only re-queues a session whose stored duration
 * estimate changed, which is the right trigger for a length or rest change but
 * misses a complaint change: swapping calf raises for nothing at all can leave
 * the estimate identical while the exercise list is completely different. The
 * in-app view rebuilds from the template on read and is right either way; the
 * calendar event and the watch workout are copies, and a copy nobody re-pushes
 * still lists the old exercises. Both queues self-gate: the watch push checks
 * this user's own Garmin workout-sync setting (isGarminWorkoutSyncEnabled) and
 * the calendar push their own connection, so this is a no-op for an athlete
 * who has neither turned on.
 *
 * Scoped to the same four-week window the app's own views show, and to planned
 * sessions only, so a completed session's record is never rewritten.
 */
export async function resyncPlannedStrengthSessions(
  profileId: string | null,
  userId: string
) {
  // Branded once here: the sync queue functions require a validated UserId
  // (see lib/user-id.ts) rather than an arbitrary string.
  const uid = asUserId(userId);
  // Calendar connections are per user now (see gcal-client loadTokens), so the
  // check needs the person, and a guest profile's sessions never go to the
  // owner's calendar — same rule ensureStrengthSchedule follows above.
  const gcal = !profileId ? await isConnected(userId).catch(() => false) : false;
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 28);

  const sessions = await db
    .select({ id: strengthSessions.id })
    .from(strengthSessions)
    .where(
      and(
        eq(strengthSessions.userId, userId),
        profileId
          ? eq(strengthSessions.profileId, profileId)
          : isNull(strengthSessions.profileId),
        eq(strengthSessions.status, "planned"),
        gte(strengthSessions.date, from),
        lte(strengthSessions.date, to)
      )
    );

  for (const s of sessions) {
    await queueGarminStrengthMove(s.id).catch(() => {});
    if (gcal) await queueStrengthSessionSync(s.id, "update", uid, "gcal").catch(() => {});
  }
  return { resynced: sessions.length };
}

/** Remove future auto-scheduled sessions the user never touched. */
export async function pruneAutoSchedule(profileId: string | null, userId: string) {
  // Branded once here: the sync queue functions require a validated UserId
  // (see lib/user-id.ts) rather than an arbitrary string.
  const uid = asUserId(userId);
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
        ownedBy(strengthSessions),
        gte(strengthSessions.date, today),
        profileId
          ? eq(strengthSessions.profileId, profileId)
          : isNull(strengthSessions.profileId)
      )
    );
  // A session can be logged into (sets, pain check-ins) without ever flipping
  // status off "planned" or clearing autoScheduled — the sets route also now
  // clears autoScheduled on first log, but this query is the backstop that
  // makes the invariant hold even if some future write path forgets to.
  // Never hard-delete anything an athlete has actually put data into.
  const candidateIds = candidates.map((s) => s.id);
  const idsWithData = new Set<string>();
  if (candidateIds.length > 0) {
    const [setRows, painRows] = await Promise.all([
      db
        .selectDistinct({ sessionId: strengthSets.sessionId })
        .from(strengthSets)
        .where(inArray(strengthSets.sessionId, candidateIds)),
      db
        .selectDistinct({ sessionId: painLogs.sessionId })
        .from(painLogs)
        .where(inArray(painLogs.sessionId, candidateIds)),
    ]);
    for (const r of setRows) idsWithData.add(r.sessionId);
    for (const r of painRows) idsWithData.add(r.sessionId);
  }

  // The selection contract lives in one tested predicate: future + planned +
  // auto-scheduled + no logged data only; completed and hand-touched sessions
  // are permanent.
  const future = candidates.filter((s) =>
    isPrunable({ ...s, hasLoggedData: idsWithData.has(s.id) }, today)
  );
  if (future.length === 0) return { removed: 0 };

  // Hard delete, deliberately, not the twin-absorption "mark skipped" pattern:
  // `future` is now, by the guard above, restricted to sessions with no logged
  // sets, no pain check-ins, and no hand edits (autoScheduled still true means
  // the sessions PATCH route's clearsAutoScheduled never fired). There is
  // nothing on these rows an athlete has ever seen or produced — unlike a
  // twin, which by definition already carries the other session's real
  // history — so there's nothing here that needs a surviving trace.
  //
  // Calendar events and watch workouts must go with their rows or they
  // linger forever on services the user can't clean up from here.
  for (const s of future) {
    if (s.gcalEventId) {
      await queueStrengthSessionSync(s.id, "delete", uid, "gcal", {
        gcalEventId: s.gcalEventId,
      }).catch(() => {});
    }
    if (s.garminWorkoutId) {
      await queueGarminStrengthDelete(uid, s.id, s.garminWorkoutId).catch(() => {});
    }
  }

  await db
    .delete(strengthSessions)
    .where(inArray(strengthSessions.id, future.map((s) => s.id)));
  return { removed: future.length };
}

/**
 * Sweep abandoned Kraft-picker/custom-workout ad-hoc sessions: not part of
 * the plan (never watchEligible), still "planned", nothing ever logged, and
 * their day has fully passed. These are throwaway trial starts the athlete
 * opened and then closed the tab/app on instead of using the in-app Back
 * button (the only client-side cleanup path — see strength/page.tsx
 * backToPicker/handleDiscardGuided) — this is the server-side backstop that
 * catches every exit path, not just that one.
 *
 * Deliberately global (every profile, not just the owner): DB clutter from
 * an abandoned guest session matters too, even though only the owner's rows
 * can ever carry a garminWorkoutId to begin with (see garmin-sync.ts —
 * every push path filters to profileId === null).
 *
 * Restricted to strictly past days so nothing mid-workout, or meant to be
 * finished later today, is ever touched — see isStaleAdhoc.
 */
export async function pruneStaleAdhocSessions(): Promise<{ removed: number }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const candidates = await db
    .select({
      id: strengthSessions.id,
      gcalEventId: strengthSessions.gcalEventId,
      garminWorkoutId: strengthSessions.garminWorkoutId,
      date: strengthSessions.date,
      status: strengthSessions.status,
      watchEligible: strengthSessions.watchEligible,
      userId: strengthSessions.userId,
    })
    .from(strengthSessions)
    .where(
      and(
        ownedBy(strengthSessions),
        eq(strengthSessions.watchEligible, false),
        lte(strengthSessions.date, today)
      )
    );

  if (candidates.length === 0) return { removed: 0 };

  const candidateIds = candidates.map((s) => s.id);
  const [setRows, painRows] = await Promise.all([
    db
      .selectDistinct({ sessionId: strengthSets.sessionId })
      .from(strengthSets)
      .where(inArray(strengthSets.sessionId, candidateIds)),
    db
      .selectDistinct({ sessionId: painLogs.sessionId })
      .from(painLogs)
      .where(inArray(painLogs.sessionId, candidateIds)),
  ]);
  const idsWithData = new Set<string>();
  for (const r of setRows) idsWithData.add(r.sessionId);
  for (const r of painRows) idsWithData.add(r.sessionId);

  const stale = candidates.filter((s) =>
    isStaleAdhoc({ ...s, hasLoggedData: idsWithData.has(s.id) }, today)
  );
  if (stale.length === 0) return { removed: 0 };

  // Nothing logged, nothing an athlete has meaningfully seen survive on
  // these rows — hard delete is safe, same reasoning as pruneAutoSchedule.
  // This sweep is global (every profile across every account), so each
  // session's own stored userId is what tells the delete which person's
  // calendar it belongs to; there is no single caller-scoped user here.
  for (const s of stale) {
    // s.userId is a stored column, not caller-supplied — validated and
    // branded here (see lib/user-id.ts asUserId).
    const owner = asUserId(s.userId);
    if (s.gcalEventId) {
      await queueStrengthSessionSync(s.id, "delete", owner, "gcal", {
        gcalEventId: s.gcalEventId,
      }).catch(() => {});
    }
    if (s.garminWorkoutId) {
      await queueGarminStrengthDelete(owner, s.id, s.garminWorkoutId).catch(() => {});
    }
  }

  await db
    .delete(strengthSessions)
    .where(inArray(strengthSessions.id, stale.map((s) => s.id)));
  return { removed: stale.length };
}

/**
 * Auto-close abandoned in-progress sessions: still "planned" with real
 * logged sets (startedAt/endedAt set — see schema.ts) whose last set is
 * older than the idle threshold (see isAutoCloseDue). Lands the session on
 * "completed" with a duration derived from its own set timestamps, exactly
 * like an in-app Finish — this is what makes an athlete's abandoned real
 * work show up in exercise history and progression instead of vanishing
 * (see getExerciseHistoryBySlug).
 *
 * Runs from two places, deliberately: the 15-minute sync-drain cron (the
 * primary path — an abandoned session is caught within roughly 30-45
 * minutes of going idle, not up to a day later) and the daily gcal cron (a
 * backstop if the frequent one is ever broken end to end, same pattern as
 * dispatchDueReminders). Both call this same function; it's cheap (one
 * indexed query plus a handful of updates on a bad day) and idempotent (a
 * session it just closed no longer matches the "planned" filter).
 *
 * Global across profiles, same reasoning as pruneStaleAdhocSessions — a
 * household guest's abandoned session needs closing too, and this never
 * touches the owner's rows or vice versa (each row is closed independently
 * on its own startedAt/endedAt).
 */
export async function autoCloseAbandonedSessions(): Promise<{ closed: number }> {
  const now = new Date();
  const candidates = await db
    .select({
      id: strengthSessions.id,
      status: strengthSessions.status,
      startedAt: strengthSessions.startedAt,
      endedAt: strengthSessions.endedAt,
      garminWorkoutId: strengthSessions.garminWorkoutId,
      userId: strengthSessions.userId,
    })
    .from(strengthSessions)
    .where(
      and(
        ownedBy(strengthSessions),
        eq(strengthSessions.status, "planned"),
        isNotNull(strengthSessions.startedAt),
        isNotNull(strengthSessions.endedAt)
      )
    );

  const due = candidates.filter((s) => isAutoCloseDue(s, now));
  if (due.length === 0) return { closed: 0 };

  for (const s of due) {
    await db
      .update(strengthSessions)
      .set(autoCloseUpdate({ startedAt: s.startedAt!, endedAt: s.endedAt! }, now))
      .where(eq(strengthSessions.id, s.id));
    // Same reasoning as the sessions PATCH route completing a session: a
    // "planned" push on the watch that's actually done is stale-is-worse-
    // than-missing, so it comes off rather than being left to look current.
    if (s.garminWorkoutId) {
      // s.userId is a stored column, not caller-supplied — validated and
      // branded here (see lib/user-id.ts asUserId).
      queueGarminStrengthDelete(asUserId(s.userId), s.id, s.garminWorkoutId).catch((err) =>
        console.error("Failed to queue Garmin delete on auto-close:", err)
      );
    }
  }
  return { closed: due.length };
}

/**
 * Prune-then-top-up in one shot. Run after a plan is created or regenerated —
 * strength sessions have no plan FK, so the old plan's future auto-scheduled
 * sessions would otherwise linger while the scheduler adds new ones on top.
 * Also safe standalone (the reconcile route) to clean up an existing mess.
 */
export async function reconcileStrengthSchedule(profileId: string | null, userId: string) {
  const t = timer("strength.reconcile");
  const { removed } = await pruneAutoSchedule(profileId, userId);
  t.mark("prune");
  const { created, shortWeeks } = await ensureStrengthSchedule(profileId, userId);
  t.mark("ensure");
  t.done({ removed, created, shortWeeks });
  return { removed, created, shortWeeks };
}

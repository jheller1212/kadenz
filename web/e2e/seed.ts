// ── E2E local-DB seed ────────────────────────────────────────────────────────
// Fills a fresh local Postgres with two users' worth of realistic data:
//
//  - The owner (OWNER_USER_ID): a running plan with weeks/workouts, a few
//    activities, strength sessions with logged sets, a wellness check-in, a
//    handful of wellness_metrics rows, plus (additive, for the cross-user
//    isolation spec) a personal record, a custom workout template and
//    reminder settings.
//  - A second athlete (USER_B_ID, e2e/env.ts): a smaller but complete parallel
//    dataset covering the same tables, so cross-user-isolation.spec.ts has a
//    real "someone else's row" to probe every tenanted route with.
//
// The owner's existing rows (plan/weeks/workouts/activities/strength/wellness)
// are UNCHANGED by this file — other specs assert on their exact shape (see
// activity-link.spec.ts, kraft-*.spec.ts) — everything for user B, and the
// owner's additive extras, are new, independently idempotent insertions.
//
// Idempotent: each of the sections below has its own existence check, so a
// second `npm run test:e2e` against the same persisted local Postgres data
// dir does no duplicate work.
//
// SAFETY: refuses to run against anything that isn't an obviously-local
// Postgres. This script runs raw INSERTs with no WHERE clause discipline —
// it must never be pointed at a shared or production database.
import { mkdirSync, writeFileSync } from "node:fs";
import { eq, and } from "drizzle-orm";
import {
  db,
  plans,
  weeks,
  workouts,
  blocks,
  activities,
  activityTrash,
  strengthSessions,
  strengthSets,
  strengthExercises,
  strengthPlanSettings,
  wellnessLogs,
  wellnessMetrics,
  personalRecords,
  customWorkoutTemplates,
  customWorkoutSlots,
  reminderSettings,
  users,
  OWNER_USER_ID,
} from "../src/db/index";
import { seedStrengthExercises } from "../src/db/seed-strength";
import { E2E_ARTIFACTS_DIR, E2E_SEED_IDS_PATH, USER_B_ID } from "./env";

function assertLocalDatabaseUrl(url: string | undefined) {
  if (!url) {
    throw new Error("[e2e-seed] DATABASE_URL is not set — refusing to run.");
  }
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`[e2e-seed] DATABASE_URL is not a valid URL: ${url}`);
  }
  const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `[e2e-seed] DATABASE_URL host "${host}" is not local (expected localhost/127.0.0.1). ` +
        "Refusing to seed a non-local database — this script is destructive-adjacent " +
        "(bulk inserts, no production guard beyond this check)."
    );
  }
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0); // noon local — clear of any midnight TZ edge
  d.setDate(d.getDate() - n);
  return d;
}

function daysFromNow(n: number): Date {
  return daysAgo(-n);
}

// ── Owner: plan, weeks, workouts, blocks, activities, strength, wellness ────
// Unchanged from before user B existed — other specs depend on this exact
// shape. Gated on "an active plan already exists", same as always.
async function ensureOwnerCore(): Promise<void> {
  const [existingActivePlan] = await db
    .select({ id: plans.id })
    .from(plans)
    .where(eq(plans.status, "active"))
    .limit(1);
  if (existingActivePlan) {
    console.log("[e2e-seed] owner: active plan already present — skipping core seed.");
    return;
  }

  // ── Plan: 6 weeks, started 2 weeks ago so "today" sits mid-plan ────────────
  const startDate = daysAgo(14);
  const planLengthWeeks = 6;
  const raceDate = daysFromNow(28);

  const [plan] = await db
    .insert(plans)
    .values({
      name: "E2E 10k Build",
      intent: "race",
      raceDistance: "10k",
      goalTimeSeconds: 45 * 60,
      vdot: 42,
      startDate,
      raceDate,
      planLengthWeeks,
      daysPerWeek: 4,
      weekStartDay: 1,
      currentWeeklyKm: 30,
      trainingVolume: "medium",
      trainingDifficulty: "moderate",
      status: "active",
      userId: OWNER_USER_ID,
    })
    .returning({ id: plans.id });

  const WEEK_PHASES: Array<"base" | "build" | "peak" | "taper"> = [
    "base",
    "base",
    "build",
    "build",
    "peak",
    "taper",
  ];
  const WORKOUT_TYPES: Array<"easy" | "tempo" | "interval" | "long"> = [
    "easy",
    "tempo",
    "interval",
    "long",
  ];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let weekNumber = 1; weekNumber <= planLengthWeeks; weekNumber++) {
    const weekStart = new Date(startDate);
    weekStart.setDate(weekStart.getDate() + (weekNumber - 1) * 7);

    const [week] = await db
      .insert(weeks)
      .values({
        planId: plan.id,
        weekNumber,
        phase: WEEK_PHASES[weekNumber - 1],
        type: "normal",
        targetKm: 28 + weekNumber * 2,
        userId: OWNER_USER_ID,
      })
      .returning({ id: weeks.id });

    // Four sessions a week: Mon/Wed/Fri/Sun offsets from the week start.
    const dayOffsets = [0, 2, 4, 6];
    for (let i = 0; i < dayOffsets.length; i++) {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + dayOffsets[i]);
      date.setHours(7, 0, 0, 0);

      const dateOnly = new Date(date);
      dateOnly.setHours(0, 0, 0, 0);
      const isPast = dateOnly.getTime() < today.getTime();
      const isToday = dateOnly.getTime() === today.getTime();
      const type = WORKOUT_TYPES[i];
      const targetKm = type === "long" ? 12 : type === "easy" ? 6 : 8;

      const [workout] = await db
        .insert(workouts)
        .values({
          weekId: week.id,
          planId: plan.id,
          dayOfWeek: date.getDay(),
          date,
          type,
          title: `${type[0].toUpperCase()}${type.slice(1)} run`,
          description: `Seeded ${type} run for e2e tests.`,
          status: isPast ? "completed" : "planned",
          targetKm,
          actualKm: isPast ? targetKm : null,
          rpe: isPast ? 5 : null,
          userId: OWNER_USER_ID,
        })
        .returning({ id: workouts.id });

      await db.insert(blocks).values({
        workoutId: workout.id,
        sortOrder: 0,
        type: "work",
        distanceKm: targetKm,
        userId: OWNER_USER_ID,
      });

      // Keep "today" visible on the Today screen without over-complicating —
      // no extra work needed, isToday is just documentation of intent here.
      void isToday;
    }
  }

  // ── A few standalone completed activities (not linked to any workout) ──────
  for (let i = 0; i < 3; i++) {
    const startDateAct = daysAgo(1 + i * 2);
    startDateAct.setHours(7, 30, 0, 0);
    await db.insert(activities).values({
      sportType: "Run",
      name: `Seeded morning run ${i + 1}`,
      distanceKm: 6 + i,
      durationSeconds: (6 + i) * 340,
      avgPaceSecKm: 340,
      avgHr: 148,
      startDate: startDateAct,
      userId: OWNER_USER_ID,
    });
  }

  // ── Strength sessions with logged sets ──────────────────────────────────────
  const exerciseRows = await db
    .select({ id: strengthExercises.id, slug: strengthExercises.slug })
    .from(strengthExercises)
    .limit(6);

  const SESSION_PLAN: Array<{ type: "full_body" | "upper" | "lower"; daysAgoN: number }> = [
    { type: "full_body", daysAgoN: 8 },
    { type: "upper", daysAgoN: 5 },
    { type: "lower", daysAgoN: 2 },
  ];

  for (const s of SESSION_PLAN) {
    const date = daysAgo(s.daysAgoN);
    const [session] = await db
      .insert(strengthSessions)
      .values({
        planId: plan.id,
        date,
        dayOfWeek: date.getDay(),
        type: s.type,
        title: `${s.type[0].toUpperCase()}${s.type.slice(1)} session`,
        status: "completed",
        targetDurationMinutes: 45,
        durationMinutes: 42,
        userId: OWNER_USER_ID,
      })
      .returning({ id: strengthSessions.id });

    const forThisSession = exerciseRows.slice(0, 3);
    for (const ex of forThisSession) {
      for (let setNumber = 1; setNumber <= 3; setNumber++) {
        await db.insert(strengthSets).values({
          sessionId: session.id,
          exerciseId: ex.id,
          setNumber,
          weightKg: 20,
          reps: 10,
          rpe: 7,
          kind: "working",
        });
      }
    }
  }

  // ── Unlinked strength activity for the e2e link-flow spec ──────────────────
  // Same day as the seeded "lower" session above, so it shows up as a link
  // candidate (candidates route: activity date ±3 days) with no extra wiring.
  await db.insert(activities).values({
    sportType: "WeightTraining",
    name: "E2E link-test activity",
    distanceKm: 0,
    durationSeconds: 1800,
    avgPaceSecKm: 0,
    avgHr: 128,
    startDate: daysAgo(2),
    userId: OWNER_USER_ID,
  });

  // ── Today's check-in (feeds readiness.hasCheckIn) ──────────────────────────
  const checkInDate = new Date();
  await db.insert(wellnessLogs).values({
    date: checkInDate,
    restDay: false,
    illness: false,
    injury: false,
    bodyweightKg: 78,
    energy: 4,
    sleepQuality: 4,
    soreness: 2,
    note: "Seeded check-in for e2e tests.",
    userId: OWNER_USER_ID,
  });

  // ── wellness_metrics: fewer nights than MIN_BASELINE_NIGHTS (21) so
  // physiology readiness stays in warm-up — see lib/physiology.ts. ─────────────
  for (let i = 0; i < 5; i++) {
    const date = daysAgo(i);
    date.setHours(0, 0, 0, 0);
    await db.insert(wellnessMetrics).values({
      date,
      sleepSeconds: 7 * 3600 + 15 * 60,
      restingHr: 48 + i,
      hrvLastNightAvg: 62 - i,
      hrvWeeklyAvg: 60,
      hrvStatus: "balanced",
      source: "garmin",
      userId: OWNER_USER_ID,
    });
  }

  console.log(
    "[e2e-seed] owner: seeded plan, weeks, workouts, activities, strength sessions, check-in, wellness metrics."
  );
}

// ── Owner: a realistic short strength week (rehab attached + standalone) ────
// Kraft settings target 4/week; only 3 land this week, and the athlete gets
// both rehab shapes #155 introduced: one plain session with the Achilles/HSR
// block attached, and one standalone rehab session. Additive and idempotent,
// same convention as ensureOwnerExtras below. Deliberately dated on
// non-today weekdays of the CURRENT calendar week: several Kraft specs
// (kraft-picker.spec.ts, kraft-duration-equipment.spec.ts) adopt "today's
// already-planned session of this type" when they tap a Programme card, and
// clearTodaysStrengthSessions (e2e/helpers.ts) unconditionally deletes every
// strength session dated today — either would silently swallow a same-day
// fixture.
async function ensureRehabWeekFixtures(): Promise<void> {
  const FIXTURE_TITLE = "E2E Rehab Week — Upper";
  const [existing] = await db
    .select({ id: strengthSessions.id })
    .from(strengthSessions)
    .where(and(eq(strengthSessions.userId, OWNER_USER_ID), eq(strengthSessions.title, FIXTURE_TITLE)))
    .limit(1);
  if (existing) {
    console.log("[e2e-seed] owner: rehab-week fixtures already present — skipping.");
    return;
  }

  const [existingSettings] = await db
    .select({ id: strengthPlanSettings.id })
    .from(strengthPlanSettings)
    .where(eq(strengthPlanSettings.userId, OWNER_USER_ID))
    .limit(1);
  if (!existingSettings) {
    await db.insert(strengthPlanSettings).values({
      userId: OWNER_USER_ID,
      profileId: null,
      goal: "running_focus",
      durationMinutes: 45,
      sessionsPerWeek: 4,
      ability: "intermediate",
      availableDays: [1, 2, 3, 4, 5],
      equipment: [],
      active: true,
      complaints: ["achilles"],
      achillesStartedAt: daysAgo(30),
    });
  }

  const [activePlan] = await db
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.userId, OWNER_USER_ID), eq(plans.status, "active")))
    .limit(1);

  const today = new Date();
  const monday = new Date(today);
  monday.setDate(monday.getDate() - ((today.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);

  function dateForOffset(offset: number): Date {
    const d = new Date(monday);
    d.setDate(d.getDate() + offset);
    d.setHours(7, 0, 0, 0);
    return d;
  }

  // Monday, Wednesday, Friday, Saturday, Sunday offsets, in priority order —
  // skip whichever equals today.
  const safeOffsets = [0, 2, 4, 5, 6].filter(
    (offset) => dateForOffset(offset).toDateString() !== today.toDateString()
  );
  const [upperOffset, achillesOffset, lowerOffset] = safeOffsets;

  await db.insert(strengthSessions).values([
    {
      planId: activePlan?.id ?? null,
      date: dateForOffset(upperOffset),
      dayOfWeek: dateForOffset(upperOffset).getDay(),
      type: "upper",
      title: FIXTURE_TITLE,
      status: "planned",
      targetDurationMinutes: 50,
      achillesAttached: true,
      autoScheduled: true,
      watchEligible: true,
      userId: OWNER_USER_ID,
    },
    {
      planId: activePlan?.id ?? null,
      date: dateForOffset(achillesOffset),
      dayOfWeek: dateForOffset(achillesOffset).getDay(),
      type: "achilles",
      title: "Rehab · Kraft",
      status: "planned",
      targetDurationMinutes: 20,
      autoScheduled: true,
      watchEligible: true,
      userId: OWNER_USER_ID,
    },
    {
      planId: activePlan?.id ?? null,
      date: dateForOffset(lowerOffset),
      dayOfWeek: dateForOffset(lowerOffset).getDay(),
      type: "lower",
      title: "E2E Rehab Week — Lower",
      status: "planned",
      targetDurationMinutes: 40,
      autoScheduled: true,
      watchEligible: true,
      userId: OWNER_USER_ID,
    },
  ]);

  console.log(
    "[e2e-seed] owner: seeded a 3-of-4 strength week (one Achilles-attached, one standalone Rehab session)."
  );
}

// ── Owner: additive extras the cross-user-isolation spec needs a "someone
// else's row" for, but the original seed never created (nobody needed a
// personal record, a custom workout, or reminder settings before there was a
// second user to leak them to). Each has its own existence check so this is
// safe to run alongside ensureOwnerCore's early return. ─────────────────────
async function ensureOwnerExtras(): Promise<void> {
  const [existingPr] = await db
    .select({ id: personalRecords.id })
    .from(personalRecords)
    .where(and(eq(personalRecords.userId, OWNER_USER_ID), eq(personalRecords.distance, "5k")))
    .limit(1);
  if (!existingPr) {
    await db.insert(personalRecords).values({
      userId: OWNER_USER_ID,
      distance: "5k",
      timeSeconds: 22 * 60,
      date: daysAgo(60),
      source: "race",
    });
  }

  const [existingTemplate] = await db
    .select({ id: customWorkoutTemplates.id })
    .from(customWorkoutTemplates)
    .where(
      and(eq(customWorkoutTemplates.userId, OWNER_USER_ID), eq(customWorkoutTemplates.name, "E2E Custom Workout"))
    )
    .limit(1);
  if (!existingTemplate) {
    const [exercise] = await db.select({ slug: strengthExercises.slug }).from(strengthExercises).limit(1);
    const [template] = await db
      .insert(customWorkoutTemplates)
      .values({ userId: OWNER_USER_ID, profileId: null, name: "E2E Custom Workout" })
      .returning({ id: customWorkoutTemplates.id });
    if (exercise) {
      await db.insert(customWorkoutSlots).values({
        templateId: template.id,
        exerciseSlug: exercise.slug,
        sets: 3,
        repLow: 8,
        repHigh: 12,
        restSeconds: 90,
        sortOrder: 0,
      });
    }
  }

  const [existingReminders] = await db
    .select({ id: reminderSettings.id })
    .from(reminderSettings)
    .where(eq(reminderSettings.userId, OWNER_USER_ID))
    .limit(1);
  if (!existingReminders) {
    await db.insert(reminderSettings).values({
      userId: OWNER_USER_ID,
      enabled: true,
      leadMinutes: 30,
      defaultTimeOfDay: "07:00",
    });
  }

  await ensureTrashFixtures(OWNER_USER_ID);

  console.log("[e2e-seed] owner: ensured personal record, custom workout template, reminder settings, trash fixtures.");
}

// Two trash rows per user (not one): cross-user-isolation.spec.ts exercises
// both POST /api/activities/trash/[id]/restore and DELETE
// /api/activities/trash/[id] against a foreign id, and both routes are
// currently unscoped — whichever is exercised first consumes its row (the
// restore route deletes it after restoring; the delete route just deletes
// it), so a single shared row would make the second route's probe land on an
// already-gone id instead of a real ownership check.
async function ensureTrashFixtures(userId: string): Promise<void> {
  const existing = await db.select({ payload: activityTrash.payload }).from(activityTrash).where(eq(activityTrash.userId, userId));
  const existingNames = new Set(existing.map((r) => (r.payload as { name?: string })?.name));

  for (const label of ["restore", "delete"] as const) {
    const marker = `E2E trash fixture (${label}, ${userId === OWNER_USER_ID ? "owner" : "userB"})`;
    if (existingNames.has(marker)) continue;
    await db.insert(activityTrash).values({
      // activity_trash.id has no default (it's normally the original
      // activities.id, kept as the PK so a delete-then-restore round-trips
      // through the same id) — this fixture never had a real activities row,
      // so a fresh uuid is the fixture's own id.
      id: crypto.randomUUID(),
      payload: {
        name: marker,
        sportType: "Run",
        distanceKm: 3,
        durationSeconds: 900,
        startDate: new Date().toISOString(),
      },
      userId,
    });
  }
}

// ── User B: a full, smaller parallel dataset covering the same tables as the
// owner, with deliberately distinguishable content (different plan name,
// different activity/session titles, different numbers) so the isolation
// spec can assert on more than just "an id differs" — a leak that returns
// the RIGHT SHAPE with the WRONG VALUES still has to fail the assertion. ────
async function ensureUserB(): Promise<void> {
  const [existingActivePlan] = await db
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.userId, USER_B_ID), eq(plans.status, "active")))
    .limit(1);
  if (existingActivePlan) {
    console.log("[e2e-seed] user B: active plan already present — skipping.");
    return;
  }

  const startDate = daysAgo(7);
  const planLengthWeeks = 2;
  const raceDate = daysFromNow(21);

  const [plan] = await db
    .insert(plans)
    .values({
      name: "E2E 5k Build — User B",
      intent: "race",
      raceDistance: "5k",
      goalTimeSeconds: 25 * 60,
      vdot: 38,
      startDate,
      raceDate,
      planLengthWeeks,
      daysPerWeek: 3,
      weekStartDay: 1,
      currentWeeklyKm: 18,
      trainingVolume: "low",
      trainingDifficulty: "easy",
      status: "active",
      userId: USER_B_ID,
    })
    .returning({ id: plans.id });

  const WORKOUT_TYPES: Array<"easy" | "tempo" | "long"> = ["easy", "tempo", "long"];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let firstWorkoutId: string | null = null;
  for (let weekNumber = 1; weekNumber <= planLengthWeeks; weekNumber++) {
    const weekStart = new Date(startDate);
    weekStart.setDate(weekStart.getDate() + (weekNumber - 1) * 7);

    const [week] = await db
      .insert(weeks)
      .values({
        planId: plan.id,
        weekNumber,
        phase: "base",
        type: "normal",
        targetKm: 16 + weekNumber,
        userId: USER_B_ID,
      })
      .returning({ id: weeks.id });

    const dayOffsets = [0, 2, 4];
    for (let i = 0; i < dayOffsets.length; i++) {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + dayOffsets[i]);
      date.setHours(7, 0, 0, 0);
      const dateOnly = new Date(date);
      dateOnly.setHours(0, 0, 0, 0);
      const isPast = dateOnly.getTime() < today.getTime();
      const type = WORKOUT_TYPES[i];
      const targetKm = type === "long" ? 8 : 4;

      const [workout] = await db
        .insert(workouts)
        .values({
          weekId: week.id,
          planId: plan.id,
          dayOfWeek: date.getDay(),
          date,
          type,
          title: `${type[0].toUpperCase()}${type.slice(1)} run (User B)`,
          description: `Seeded ${type} run for user B e2e tests.`,
          status: isPast ? "completed" : "planned",
          targetKm,
          actualKm: isPast ? targetKm : null,
          rpe: isPast ? 4 : null,
          userId: USER_B_ID,
        })
        .returning({ id: workouts.id });
      firstWorkoutId ??= workout.id;

      await db.insert(blocks).values({
        workoutId: workout.id,
        sortOrder: 0,
        type: "work",
        distanceKm: targetKm,
        userId: USER_B_ID,
      });
    }
  }

  const [activity] = await db
    .insert(activities)
    .values({
      sportType: "Run",
      name: "Seeded morning run B1",
      distanceKm: 5,
      durationSeconds: 5 * 330,
      avgPaceSecKm: 330,
      avgHr: 152,
      startDate: daysAgo(1),
      userId: USER_B_ID,
    })
    .returning({ id: activities.id });

  const exerciseRows = await db
    .select({ id: strengthExercises.id, slug: strengthExercises.slug })
    .from(strengthExercises)
    .limit(3);

  const [strengthSession] = await db
    .insert(strengthSessions)
    .values({
      planId: plan.id,
      date: daysAgo(3),
      dayOfWeek: daysAgo(3).getDay(),
      type: "full_body",
      title: "Full body session (User B)",
      status: "completed",
      targetDurationMinutes: 30,
      durationMinutes: 28,
      userId: USER_B_ID,
    })
    .returning({ id: strengthSessions.id });

  for (const ex of exerciseRows) {
    for (let setNumber = 1; setNumber <= 2; setNumber++) {
      await db.insert(strengthSets).values({
        sessionId: strengthSession.id,
        exerciseId: ex.id,
        setNumber,
        weightKg: 15,
        reps: 12,
        rpe: 6,
        kind: "working",
      });
    }
  }

  const [wellnessLog] = await db
    .insert(wellnessLogs)
    .values({
      date: new Date(),
      restDay: false,
      illness: false,
      injury: false,
      bodyweightKg: 65,
      energy: 5,
      sleepQuality: 5,
      soreness: 1,
      note: "Seeded check-in for user B e2e tests.",
      userId: USER_B_ID,
    })
    .returning({ id: wellnessLogs.id });

  const [personalRecord] = await db
    .insert(personalRecords)
    .values({
      userId: USER_B_ID,
      distance: "5k",
      timeSeconds: 27 * 60,
      date: daysAgo(30),
      source: "race",
    })
    .returning({ id: personalRecords.id });

  const [customTemplate] = await db
    .insert(customWorkoutTemplates)
    .values({ userId: USER_B_ID, profileId: null, name: "E2E Custom Workout — User B" })
    .returning({ id: customWorkoutTemplates.id });
  if (exerciseRows[0]) {
    await db.insert(customWorkoutSlots).values({
      templateId: customTemplate.id,
      exerciseSlug: exerciseRows[0].slug,
      sets: 2,
      repLow: 10,
      repHigh: 15,
      restSeconds: 60,
      sortOrder: 0,
    });
  }

  await db.insert(reminderSettings).values({
    userId: USER_B_ID,
    enabled: false,
    leadMinutes: 45,
    defaultTimeOfDay: "08:00",
  });

  await ensureTrashFixtures(USER_B_ID);

  console.log(
    `[e2e-seed] user B: seeded plan ${plan.id}, workout ${firstWorkoutId}, activity ${activity.id}, ` +
      `strength session ${strengthSession.id}, wellness log ${wellnessLog.id}, personal record ${personalRecord.id}, ` +
      `custom workout ${customTemplate.id}.`
  );
}

// ── Ids the cross-user-isolation spec needs, written to disk rather than
// guessed. Queried fresh at the end regardless of which sections above
// actually ran this time — that way a re-run against an already-seeded DB
// (the ensure* early returns) still produces a correct, current artifact
// instead of a stale one from whichever run first created the file. ────────
async function writeSeedIdsArtifact(): Promise<void> {
  async function idsFor(userId: string) {
    const [plan] = await db
      .select({ id: plans.id })
      .from(plans)
      .where(and(eq(plans.userId, userId), eq(plans.status, "active")))
      .limit(1);
    const [week] = plan
      ? await db.select({ id: weeks.id }).from(weeks).where(eq(weeks.planId, plan.id)).limit(1)
      : [];
    const [workout] = plan
      ? await db.select({ id: workouts.id }).from(workouts).where(eq(workouts.planId, plan.id)).limit(1)
      : [];
    const [activity] = await db
      .select({ id: activities.id })
      .from(activities)
      .where(eq(activities.userId, userId))
      .limit(1);
    const [strengthSession] = await db
      .select({ id: strengthSessions.id })
      .from(strengthSessions)
      .where(eq(strengthSessions.userId, userId))
      .limit(1);
    const [wellnessLog] = await db
      .select({ id: wellnessLogs.id })
      .from(wellnessLogs)
      .where(eq(wellnessLogs.userId, userId))
      .limit(1);
    const [personalRecord] = await db
      .select({ id: personalRecords.id })
      .from(personalRecords)
      .where(eq(personalRecords.userId, userId))
      .limit(1);
    const [customWorkout] = await db
      .select({ id: customWorkoutTemplates.id })
      .from(customWorkoutTemplates)
      .where(eq(customWorkoutTemplates.userId, userId))
      .limit(1);
    const trashRows = await db
      .select({ id: activityTrash.id, payload: activityTrash.payload })
      .from(activityTrash)
      .where(eq(activityTrash.userId, userId));
    const trashRestore = trashRows.find((r) => (r.payload as { name?: string })?.name?.startsWith("E2E trash fixture (restore"));
    const trashDelete = trashRows.find((r) => (r.payload as { name?: string })?.name?.startsWith("E2E trash fixture (delete"));
    return {
      planId: plan?.id ?? null,
      weekId: week?.id ?? null,
      workoutId: workout?.id ?? null,
      activityId: activity?.id ?? null,
      strengthSessionId: strengthSession?.id ?? null,
      wellnessLogId: wellnessLog?.id ?? null,
      personalRecordId: personalRecord?.id ?? null,
      customWorkoutId: customWorkout?.id ?? null,
      trashRestoreId: trashRestore?.id ?? null,
      trashDeleteId: trashDelete?.id ?? null,
    };
  }

  const [exerciseRow] = await db.select({ id: strengthExercises.id }).from(strengthExercises).limit(1);

  const artifact = {
    exerciseId: exerciseRow?.id ?? null, // shared catalogue — same id for both users
    owner: await idsFor(OWNER_USER_ID),
    userB: await idsFor(USER_B_ID),
  };

  mkdirSync(E2E_ARTIFACTS_DIR, { recursive: true });
  writeFileSync(E2E_SEED_IDS_PATH, JSON.stringify(artifact, null, 2));
  console.log(`[e2e-seed] wrote seed ids to ${E2E_SEED_IDS_PATH}`);
}

export async function seedAll(): Promise<void> {
  assertLocalDatabaseUrl(process.env.DATABASE_URL);

  // Both users' identity rows. In production these come from
  // drizzle/0051_users.sql (owner) and a real OAuth login (user B never
  // exists in production — it's an e2e-only fixture), but the harness builds
  // its schema with `drizzle-kit push` and replays no migrations, so both
  // have to be seeded here. Runs before every ensure* below, which reference
  // one or the other as a foreign key.
  await db.insert(users).values({ id: OWNER_USER_ID, displayName: "E2E Owner" }).onConflictDoNothing();
  await db.insert(users).values({ id: USER_B_ID, displayName: "E2E User B" }).onConflictDoNothing();

  const exerciseCount = await seedStrengthExercises();
  console.log(`[e2e-seed] strength catalogue: ${exerciseCount} exercises.`);

  await ensureOwnerCore();
  await ensureRehabWeekFixtures();
  await ensureOwnerExtras();
  await ensureUserB();
  await writeSeedIdsArtifact();
}

// Only run as a CLI script (`tsx e2e/seed.ts`, e.g. to reseed by hand against
// an already-running local Postgres), never on import — global-setup.ts
// imports seedAll() directly and must not trigger a second process.exit()
// as a side effect of loading this module.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  seedAll()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[e2e-seed] failed:", err);
      process.exit(1);
    });
}

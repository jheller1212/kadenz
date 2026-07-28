// ── E2E local-DB seed ────────────────────────────────────────────────────────
// Fills a fresh local Postgres with one owner's worth of realistic data: a
// running plan with weeks/workouts, a few activities, strength sessions with
// logged sets, a wellness check-in, and a handful of wellness_metrics rows.
//
// Idempotent: if an active plan already exists, assumes this DB was already
// seeded (by an earlier `npm run test:e2e` run against the same persisted
// local Postgres data dir) and does nothing further. Re-running against the
// same local DB is always safe.
//
// SAFETY: refuses to run against anything that isn't an obviously-local
// Postgres. This script runs raw INSERTs with no WHERE clause discipline —
// it must never be pointed at a shared or production database.
import { eq } from "drizzle-orm";
import {
  db,
  plans,
  weeks,
  workouts,
  blocks,
  activities,
  strengthSessions,
  strengthSets,
  strengthExercises,
  wellnessLogs,
  wellnessMetrics,
} from "../src/db/index";
import { seedStrengthExercises } from "../src/db/seed-strength";

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

export async function seedAll(): Promise<void> {
  assertLocalDatabaseUrl(process.env.DATABASE_URL);

  const exerciseCount = await seedStrengthExercises();
  console.log(`[e2e-seed] strength catalogue: ${exerciseCount} exercises.`);

  const [existingActivePlan] = await db
    .select({ id: plans.id })
    .from(plans)
    .where(eq(plans.status, "active"))
    .limit(1);
  if (existingActivePlan) {
    console.log("[e2e-seed] active plan already present — assuming this DB is already seeded.");
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
        })
        .returning({ id: workouts.id });

      await db.insert(blocks).values({
        workoutId: workout.id,
        sortOrder: 0,
        type: "work",
        distanceKm: targetKm,
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
    });
  }

  console.log("[e2e-seed] seeded plan, weeks, workouts, activities, strength sessions, check-in, wellness metrics.");
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

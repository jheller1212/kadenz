import { relations, sql } from "drizzle-orm";
import {
  index,
  uniqueIndex,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  real,
  boolean,
} from "drizzle-orm/pg-core";

// ── Enums ────────────────────────────────────────────────────────────────────

export const raceDistanceEnum = pgEnum("race_distance", [
  "5k",
  "10k",
  "half",
  "marathon",
  "ultra",
  "custom",
]);

export const planStatusEnum = pgEnum("plan_status", [
  "active",
  "completed",
  "archived",
]);

export const trainingVolumeEnum = pgEnum("training_volume", [
  "beginner",
  "low",
  "medium",
  "high",
  "elite",
]);

export const trainingDifficultyEnum = pgEnum("training_difficulty", [
  "easy",
  "moderate",
  "hard",
]);

export const weekPhaseEnum = pgEnum("week_phase", [
  "base",
  "build",
  "peak",
  "taper",
]);

export const weekTypeEnum = pgEnum("week_type", ["normal", "deload", "race"]);

export const workoutTypeEnum = pgEnum("workout_type", [
  "easy",
  "long",
  "tempo",
  "interval",
  "recovery",
  "race",
  "rest",
]);

export const workoutStatusEnum = pgEnum("workout_status", [
  "planned",
  "completed",
  "skipped",
  "missed",
]);

export const blockTypeEnum = pgEnum("block_type", [
  "warmup",
  "work",
  "recovery",
  "cooldown",
]);

export const prDistanceEnum = pgEnum("pr_distance", [
  "5k",
  "10k",
  "half",
  "marathon",
  "mile",
]);

export const prSourceEnum = pgEnum("pr_source", [
  "race",
  "time_trial",
  "estimate",
]);

export const syncEntityTypeEnum = pgEnum("sync_entity_type", [
  "workout",
  "week",
  "plan",
  "strength_session",
]);

// ── Strength module enums ────────────────────────────────────────────────────

export const strengthCategoryEnum = pgEnum("strength_category", [
  "upper",
  "lower",
  "achilles",
  "full_body",
]);

export const strengthSessionTypeEnum = pgEnum("strength_session_type", [
  "upper",
  "lower",
  "lower_achilles",
  "upper_achilles",
  "achilles",
  "full_body",
]);

export const painTimingEnum = pgEnum("pain_timing", [
  "during",
  "after",
  "next_day",
]);

export const syncActionEnum = pgEnum("sync_action", [
  "create",
  "update",
  "delete",
]);

export const syncTargetEnum = pgEnum("sync_target", ["gcal", "garmin"]);

export const syncStatusEnum = pgEnum("sync_status", [
  "pending",
  "processing",
  "completed",
  "failed",
  // Never attempted, deliberately retired: the job's plan was archived, or
  // its entity row no longer exists, before a worker ever picked it up.
  // Kept distinct from "failed" (which means an attempt was made and erred)
  // so the outbox history stays honest about what actually happened.
  "cancelled",
]);

// ── Tables ───────────────────────────────────────────────────────────────────

// The id of the athlete Kadenz was built for. A fixed constant rather than a
// generated uuid so the migration that seeds the row, the e2e seed and the
// application code can all name the same user without reading it back from
// anywhere. Kept in sync with drizzle/0051_users.sql.
export const OWNER_USER_ID = "00000000-0000-0000-0000-000000000001";

// Phase 2 of the multi-user plan gives every tenanted table below a
// `user_id` column, defaulted at the database level to OWNER_USER_ID. That
// default is deliberate and load-bearing, not a shortcut: Phase 2 does not
// touch the ~62 query call sites that insert rows across the app, so none of
// them pass user_id yet. Without the default, making the column NOT NULL
// would break every insert in the app today. Phase 3 is what sets user_id
// explicitly at each call site and then drops these defaults. A default
// that silently attributes every new row to the owner is exactly the wrong
// behaviour once a second user exists, so it must not survive past Phase 3.

// A person using Kadenz. Separate from `user_identities` because one person
// can log in with both Strava and Google, and both must resolve to this one
// row rather than to two half-populated accounts.
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email"),
  displayName: text("display_name"),
  // "km" | "miles". The server-readable copy of the athlete's unit
  // preference, which otherwise lives only in localStorage and so is
  // invisible to anything the cron generates (watch, calendar, push).
  // CHECK-constrained in 0057; see lib/user-units.ts for the typed reader.
  distanceUnit: text("distance_unit").notNull().default("km"),
  // "kg" | "lbs". Needed because a strength session's calendar event lists
  // each exercise's load.
  weightUnit: text("weight_unit").notNull().default("kg"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// One OAuth account that proves someone is a given user. The allowlist in
// lib/owner.ts still decides who may log in at all; this only records who
// they turned out to be once they were let through.
export const userIdentities = pgTable(
  "user_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    // "strava" | "google"
    provider: text("provider").notNull(),
    // Strava athlete id, or the Google subject claim. Stable per provider —
    // deliberately not the email, which a Google account can change.
    providerAccountId: text("provider_account_id").notNull(),
    email: text("email"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("user_identities_provider_account_uq").on(
      t.provider,
      t.providerAccountId
    ),
    index("user_identities_user_id_idx").on(t.userId),
  ]
);

// One person's OAuth credentials for one external service. Phase 4 of the
// multi-user plan (see drizzle/0058_integration_credentials.sql): these tokens
// used to be a single row in sync_outbox under a fixed idempotency key, so the
// second person to connect Strava or Google silently took over the first
// person's integration.
//
// Unlike the Phase 2 tenancy columns, userId here carries NO default. There is
// no such thing as an unattributed credential: the row means "this person
// connected this account", and a default would make the first plausible answer
// (the owner) the wrong one.
export const integrationCredentials = pgTable(
  "integration_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // "strava" | "google"
    provider: text("provider").notNull(),
    // The provider's token set. Shape is owned by the client module that reads
    // it (StravaTokens in strava-client.ts, GCalTokens in gcal-client.ts).
    //
    // Deliberately no provider_account_id column here. The Strava webhook does
    // need to turn an athlete id into a user, but user_identities already
    // stores exactly that pair under a unique index, and it is identity rather
    // than tenanted data so it stays readable before any user context exists.
    // A copy of the athlete id next to the tokens would be the same fact in
    // two places, free to drift, and unreadable at the moment the webhook
    // actually needs it. See findUserByProviderAccount in lib/sync/credentials.ts.
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("integration_credentials_user_provider_uq").on(
      t.userId,
      t.provider
    ),
  ]
);

// Per-user sync bookkeeping: the Garmin activity-import bookmark and the
// "send workouts to the watch" toggle. Both were single global rows in
// sync_outbox before Phase 4 (see drizzle/0059_user_integration_state.sql),
// which meant a per-user import loop would have had every iteration overwrite
// the same bookmark and each athlete would re-import or skip activities
// depending on who ran last.
//
// Key/value rather than a column per setting: both values are small blobs only
// their own reader understands, and the next one should not need a migration.
// As with integrationCredentials, userId carries no default.
export const userIntegrationState = pgTable(
  "user_integration_state",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })]
);

// Household members. The owner has NO row — a NULL profile_id on scoped tables
// means "the owner". Guest profiles (e.g. partner) get their own strength
// sessions and wellness logs, selected via the kadenz_profile cookie.
export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    color: text("color"),
    // Soft-delete flag. "Remove person" flips this to false instead of dropping
    // the row, so it can never cascade away the strength sessions/check-ins/
    // custom workouts a cascading FK delete would otherwise take with it. Every
    // list/lookup query below filters on this.
    active: boolean("active").notNull().default(true),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id)
      .default(OWNER_USER_ID),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("profiles_user_id_idx").on(t.userId)]
);

export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    // "race" | "get_fit" | "maintain". Non-race plans have no real race day/goal;
    // race_distance/goal_time/race_date carry synthetic reference values for them.
    intent: text("intent").notNull().default("race"),
    raceDistance: raceDistanceEnum("race_distance").notNull(),
    // Set only when raceDistance is "custom".
    customDistanceKm: real("custom_distance_km"),
    goalTimeSeconds: integer("goal_time_seconds").notNull(),
    vdot: real("vdot").notNull(),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    raceDate: timestamp("race_date", { withTimezone: true }).notNull(),
    planLengthWeeks: integer("plan_length_weeks").notNull(),
    daysPerWeek: integer("days_per_week").notNull(),
    preferredLongRunDay: integer("preferred_long_run_day"), // 0=Sun … 6=Sat
    weekStartDay: integer("week_start_day").notNull().default(1), // 1=Mon
    currentWeeklyKm: real("current_weekly_km"),
    trainingVolume: trainingVolumeEnum("training_volume").notNull(),
    trainingDifficulty: trainingDifficultyEnum("training_difficulty").notNull(),
    longRunCapKm: real("long_run_cap_km"),
    easyRunMinKm: real("easy_run_min_km"),
    hillyArea: boolean("hilly_area").notNull().default(false),
    // Self-reported level from onboarding ("beginner" | "intermediate" | "advanced" | "elite")
    runnerLevel: text("runner_level"),
    // Explicit training days chosen in onboarding (JS weekdays, 0=Sun … 6=Sat)
    availableDays: jsonb("available_days").$type<number[]>(),
    status: planStatusEnum("status").notNull().default("active"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id)
      .default(OWNER_USER_ID),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("plans_status_idx").on(t.status),
    index("plans_user_id_idx").on(t.userId),
  ]
);

export const weeks = pgTable(
  "weeks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    weekNumber: integer("week_number").notNull(),
    phase: weekPhaseEnum("phase").notNull(),
    type: weekTypeEnum("type").notNull().default("normal"),
    targetKm: real("target_km"),
    actualKm: real("actual_km"),
    // Set when the athlete drops this week (illness/travel/injury — see
    // "skip a week"). Week numbering and every other week's dates are left
    // untouched deliberately: date-derived week lookups elsewhere (strength
    // phase/deload backoff, Garmin labels) assume a contiguous, un-shifted
    // week-number-from-startDate mapping, so renumbering or shifting dates
    // would silently desync them. The dropped week just becomes an empty
    // (skipped) week in place; the race day never moves.
    skippedAt: timestamp("skipped_at", { withTimezone: true }),
    skipReason: text("skip_reason"),
    // Snapshot of the workouts this action transitioned to "skipped"
    // (id + previous status), so Undo can restore exactly those rows —
    // never a workout the athlete had already skipped or completed
    // themselves before this action ran.
    skipSnapshot: jsonb("skip_snapshot").$type<{ id: string; status: string }[]>(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id)
      .default(OWNER_USER_ID),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("weeks_plan_id_idx").on(t.planId),
    index("weeks_plan_week_idx").on(t.planId, t.weekNumber),
    index("weeks_user_id_idx").on(t.userId),
  ]
);

export const workouts = pgTable(
  "workouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    weekId: uuid("week_id")
      .notNull()
      .references(() => weeks.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    dayOfWeek: integer("day_of_week").notNull(), // 0=Sun … 6=Sat
    date: timestamp("date", { withTimezone: true }).notNull(),
    type: workoutTypeEnum("type").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: workoutStatusEnum("status").notNull().default("planned"),
    targetKm: real("target_km"),
    actualKm: real("actual_km"),
    // Post-run effort (Borg 0–10), captured on completion; feeds readiness.
    rpe: real("rpe"),
    // True once the athlete hand-tuned this workout (distance/pace override).
    edited: boolean("edited").notNull().default(false),
    targetDurationMinutes: integer("target_duration_minutes"),
    // Elapsed time of a completed guided phone run (seconds); null for runs
    // completed without the guided player or imported from Strava/Garmin.
    actualDurationSeconds: integer("actual_duration_seconds"),
    // "HH:mm" 24h local time of day, or null. Null means "no specific time" —
    // NOT midnight — so a workout with no time set never renders as 00:00 and
    // never pushes a midnight event to the calendar.
    timeOfDay: text("time_of_day"),
    gcalEventId: text("gcal_event_id"),
    garminWorkoutId: text("garmin_workout_id"),
    stravaActivityId: text("strava_activity_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    // Explicit race-result capture (type "race" workouts only). Kept separate
    // from actualDurationSeconds/actualKm (which any completed workout may
    // carry from a guided run or a synced activity) so the fitness estimator
    // and plan-lifecycle logic can tell a deliberately logged race result
    // apart from an ordinary run, and so undoing a normal completion never
    // accidentally erases a race result.
    raceFinishSeconds: integer("race_finish_seconds"),
    // Free-text, athlete's own words on how it went — cheap to capture,
    // shown back on the post-race screen and worth more than nothing.
    raceFeel: text("race_feel"),
    raceResultLoggedAt: timestamp("race_result_logged_at", { withTimezone: true }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id)
      .default(OWNER_USER_ID),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("workouts_week_id_idx").on(t.weekId),
    index("workouts_plan_id_idx").on(t.planId),
    index("workouts_date_idx").on(t.date),
    index("workouts_status_idx").on(t.status),
    index("workouts_user_id_idx").on(t.userId),
  ]
);

export const blocks = pgTable(
  "blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workoutId: uuid("workout_id")
      .notNull()
      .references(() => workouts.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    type: blockTypeEnum("type").notNull(),
    durationMinutes: integer("duration_minutes"),
    distanceKm: real("distance_km"),
    targetPaceSecKm: integer("target_pace_sec_km"),
    minPaceSecKm: integer("min_pace_sec_km"),
    maxPaceSecKm: integer("max_pace_sec_km"),
    reps: integer("reps"),
    repDistanceKm: real("rep_distance_km"),
    repRestSeconds: integer("rep_rest_seconds"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id)
      .default(OWNER_USER_ID),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("blocks_workout_id_idx").on(t.workoutId),
    index("blocks_user_id_idx").on(t.userId),
  ]
);

export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workoutId: uuid("workout_id").references(() => workouts.id, {
      onDelete: "set null",
    }),
    // A recorded activity can instead back a strength session (HR/calories for
    // a lift). Exactly one of workoutId / strengthSessionId is set when linked.
    strengthSessionId: uuid("strength_session_id").references(
      () => strengthSessions.id,
      { onDelete: "set null" }
    ),
    // Strava sport_type ("Run", "WeightTraining", "Workout", …) — drives the
    // unified feed's type badge and run-vs-strength matching.
    sportType: text("sport_type"),
    // Retained for compatibility while readers migrate to provider/externalId
    // below (see src/lib/activity-provider.ts) — do not add new readers of
    // these two columns, and do not drop them until the eventual cleanup
    // pass (docs/DUPLICATION.md: one concept, computed in one place).
    stravaId: text("strava_id").unique(),
    // Garmin activity id for watch-recorded activities imported via the
    // garmin-worker (stravaId stays null for those).
    garminId: text("garmin_id").unique(),
    // Generic replacement for stravaId/garminId so a new source (Apple
    // Health, Health Connect, ...) never needs its own column. Written
    // alongside the legacy column on every write path; both are populated
    // in parallel until readers have fully migrated.
    provider: text("provider"),
    externalId: text("external_id"),
    name: text("name"),
    distanceKm: real("distance_km"),
    durationSeconds: integer("duration_seconds"),
    avgPaceSecKm: integer("avg_pace_sec_km"),
    avgHr: integer("avg_hr"),
    maxHr: integer("max_hr"),
    elevationGain: real("elevation_gain"),
    maxElevation: real("max_elevation"),
    startDate: timestamp("start_date", { withTimezone: true }),
    splitsJson: jsonb("splits_json"),
    lapsJson: jsonb("laps_json"),
    // Encoded route polyline (Strava map.summary_polyline). Null for
    // manual/treadmill/Garmin-origin rows without GPS.
    polyline: text("polyline"),
    // Cached AI workout insight — generated once per activity, regenerable.
    aiInsight: text("ai_insight"),
    aiInsightGeneratedAt: timestamp("ai_insight_generated_at", {
      withTimezone: true,
    }),
    // Cached Strava detail — immutable once synced. Populated for free at
    // import (already fetched there) or back-filled on first detail view.
    bestEffortsJson: jsonb("best_efforts_json"),
    cadenceSpm: integer("cadence_spm"),
    calories: integer("calories"),
    deviceName: text("device_name"),
    gearName: text("gear_name"),
    // Cached Strava streams (heartrate/velocity/altitude/latlng/distance/time
    // at medium resolution) — never fetched at import (would double the
    // Strava calls per sync), only back-filled on first detail view.
    streamsJson: jsonb("streams_json"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id)
      .default(OWNER_USER_ID),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("activities_workout_id_idx").on(t.workoutId),
    index("activities_strava_id_idx").on(t.stravaId),
    index("activities_strength_session_id_idx").on(t.strengthSessionId),
    // Partial: manually created activities have neither field set, and
    // Postgres never treats NULL as colliding with NULL in a unique index —
    // see drizzle/0050_activity_provider_external_id.sql for the full
    // reasoning behind the WHERE clause.
    //
    // Phase 3 has to widen this to (user_id, provider, external_id). It is
    // global today, so two athletes who both ran the same Strava activity
    // cannot both import it: the second one silently loses. This is the index
    // that matters, not the legacy strava_id/garmin_id uniques, because
    // readers are migrating onto this pair. Keep the WHERE predicate when
    // widening, and note that Postgres rejects a partial index as an
    // onConflict target unless the statement repeats a matching WHERE.
    // Nothing upserts against it today (both call sites pre-check with a
    // select), so the first conversion to an upsert finds that out at
    // runtime rather than at build.
    //
    // Widening this index is not enough on its own. The legacy strava_id and
    // garmin_id uniques below are still live and still global, so until those
    // columns are dropped they stay the binding constraint: a second athlete
    // importing the same Strava activity still collides, and the widened
    // index looks as though it changed nothing. The legacy-column cleanup and
    // this widening are one piece of work, not two.
    uniqueIndex("activities_provider_external_id_uq")
      .on(t.provider, t.externalId)
      .where(sql`${t.provider} is not null and ${t.externalId} is not null`),
    index("activities_user_id_idx").on(t.userId),
  ]
);

// Tombstones for user-deleted synced activities: sync (webhook + backfill)
// must never re-import these Strava ids.
export const deletedActivities = pgTable(
  "deleted_activities",
  {
    stravaId: text("strava_id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id)
      .default(OWNER_USER_ID),
    deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("deleted_activities_user_id_idx").on(t.userId)]
);

// Recently deleted activities: full original row kept as jsonb for 30 days so
// deletes are recoverable. id is the original activities.id.
export const activityTrash = pgTable(
  "activity_trash",
  {
    id: uuid("id").primaryKey(),
    payload: jsonb("payload").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id)
      .default(OWNER_USER_ID),
    deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("activity_trash_user_id_idx").on(t.userId)]
);

export const personalRecords = pgTable(
  "personal_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    distance: prDistanceEnum("distance").notNull(),
    timeSeconds: integer("time_seconds").notNull(),
    date: timestamp("date", { withTimezone: true }),
    source: prSourceEnum("source").notNull().default("race"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id)
      .default(OWNER_USER_ID),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("personal_records_distance_idx").on(t.distance),
    index("personal_records_user_id_idx").on(t.userId),
  ]
);

export const syncOutbox = pgTable(
  "sync_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: syncEntityTypeEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: syncActionEnum("action").notNull(),
    target: syncTargetEnum("target").notNull(),
    payload: jsonb("payload"),
    status: syncStatusEnum("status").notNull().default("pending"),
    // Unique table-wide, which is what allowed the Strava and Google token
    // singletons to live in this table in the first place.
    //
    // Phase 3 must widen this to (user_id, idempotency_key), and it is the
    // nastiest of the global uniques for a specific reason: under RLS, an
    // INSERT ... ON CONFLICT DO UPDATE needs the conflicting row to be
    // visible to the policy. Conflict with a row belonging to another user and
    // Postgres raises a unique violation instead of updating, because the
    // statement cannot see what it collided with. So per-user code reusing an
    // idempotency key pattern fails in production and passes in any test with
    // one user in the database, which is every test we have.
    idempotencyKey: text("idempotency_key").unique(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    // When a worker claimed the job. Lets the cron reset rows abandoned
    // mid-flight (serverless timeout, deploy) instead of wedging forever.
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id)
      .default(OWNER_USER_ID),
  },
  (t) => [
    index("sync_outbox_status_idx").on(t.status),
    index("sync_outbox_entity_idx").on(t.entityType, t.entityId),
    index("sync_outbox_target_idx").on(t.target),
    index("sync_outbox_user_id_idx").on(t.userId),
  ]
);

// ── Strength module tables ───────────────────────────────────────────────────

// Exercise catalogue. Seeded once; referenced by logged sets. `slug` is a
// stable key used by the program templates and for idempotent seeding.
export const strengthExercises = pgTable(
  "strength_exercises",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    category: strengthCategoryEnum("category").notNull(),
    equipmentNote: text("equipment_note"),
    tempoNote: text("tempo_note"),
    // insertional-Achilles history: no deficit raises off a step
    flatGroundOnly: boolean("flat_ground_only").notNull().default(false),
    // overhead press is flagged a slow progressor (smaller/less-frequent bumps)
    slowProgressor: boolean("slow_progressor").notNull().default(false),
    defaultSets: integer("default_sets"),
    repLow: integer("rep_low"),
    repHigh: integer("rep_high"),
    // suggested starting load per dumbbell (kg); null = bodyweight to start
    startWeightKg: real("start_weight_kg"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("strength_exercises_category_idx").on(t.category)]
);

export const strengthSessions = pgTable(
  "strength_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Optional link to the active run plan so strength lives in one weekly plan.
    planId: uuid("plan_id").references(() => plans.id, {
      onDelete: "set null",
    }),
    // NULL = owner; set = household guest profile
    profileId: uuid("profile_id").references(() => profiles.id, {
      onDelete: "cascade",
    }),
    date: timestamp("date", { withTimezone: true }).notNull(),
    dayOfWeek: integer("day_of_week").notNull(), // 0=Sun … 6=Sat
    type: strengthSessionTypeEnum("type").notNull(),
    title: text("title").notNull(),
    status: workoutStatusEnum("status").notNull().default("planned"),
    targetDurationMinutes: integer("target_duration_minutes"),
    durationMinutes: integer("duration_minutes"), // actual, from session clock
    notes: text("notes"),
    gcalEventId: text("gcal_event_id"),
    garminWorkoutId: text("garmin_workout_id"),
    // Created by the weekly scheduler (safe to prune when settings change).
    autoScheduled: boolean("auto_scheduled").notNull().default(false),
    // True only for sessions that belong to the ongoing plan: created by the
    // weekly scheduler (autoScheduled) or deliberately placed onto a date from
    // Plan > Rearrange. Governs automatic Garmin delivery — see
    // lib/sync/garmin-sync.ts queueGarminStrengthMove/queueGarminStrengthWindowSync.
    // A Kraft-picker "Start" or custom-workout quick-start session is NOT
    // watch-eligible: it only reaches the watch if the athlete taps the
    // explicit "Send to watch" control (POST /sessions/[id]/garmin), which
    // never needs this flag because a stored garminWorkoutId is itself proof
    // of deliberate delivery.
    watchEligible: boolean("watch_eligible").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    // Hand edits to this session's exercise list, layered onto the
    // template-derived plan at read time (see lib/strength/session.ts
    // applyExerciseOverrides). "removed" drops a slot; "swapped" replaces it
    // with a same-pattern/equipment-fit alternative, keeping the original
    // slot's sets/reps/rest. Never applies to Achilles-role work (rehab, not
    // filler — see EXERCISE_BY_SLUG[slug].achillesRole).
    exerciseOverrides: jsonb("exercise_overrides")
      .$type<
        Array<
          | { slug: string; action: "removed" }
          | { slug: string; action: "swapped"; replacementSlug: string }
        >
      >()
      .notNull()
      .default([]),
    // The athlete's own exercise order for this session, as slugs, set when
    // the session starts from the pre-start sheet (drag to reorder, or a sort
    // chip) and re-applied to the template-derived plan on every read (see
    // lib/strength/session.ts applyExerciseOrder). Deliberately its own
    // column rather than another exerciseOverrides entry: overrides may never
    // touch Achilles work and are rejected once an exercise has sets logged,
    // and neither rule fits order, which has its own (explosive before slow
    // heavy calf work) and stays editable mid-session.
    // Null = no custom order, the plan's own order stands.
    exerciseOrder: text("exercise_order").array(),
    // Per-session overrides ("I'm at the gym today", "only got 30 min today")
    // — apply to THIS session only, never written back to
    // strength_plan_settings. Null = no override, use the profile's default
    // (see lib/strength/service.ts buildPlannedSession). Re-applied on every
    // read (lib/strength/session.ts has no stored per-session exercise list
    // — see the comment above applyExerciseOverrides), so these must be
    // persisted here rather than only used at creation time, or a reopened
    // session would silently revert to the profile default.
    equipmentOverride: text("equipment_override").array(),
    durationOverrideMinutes: integer("duration_override_minutes"),
    // Real wall-clock start/end, derived from logged sets (first/last
    // strength_sets.createdAt) rather than "Start"/"Finish" button taps — see
    // the 0046 migration and lib/strength/reconcile.ts for why. Null until
    // the first set is logged; endedAt keeps moving forward with every set
    // and is what the auto-close sweep and the completion PATCH both read as
    // the session's real finish time.
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id)
      .default(OWNER_USER_ID),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("strength_sessions_plan_id_idx").on(t.planId),
    index("strength_sessions_profile_id_idx").on(t.profileId),
    index("strength_sessions_date_idx").on(t.date),
    index("strength_sessions_status_idx").on(t.status),
    index("strength_sessions_type_idx").on(t.type),
    index("strength_sessions_user_id_idx").on(t.userId),
  ]
);

export const strengthSets = pgTable(
  "strength_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => strengthSessions.id, { onDelete: "cascade" }),
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => strengthExercises.id, { onDelete: "cascade" }),
    setNumber: integer("set_number").notNull(),
    weightKg: real("weight_kg"),
    reps: integer("reps"),
    rpe: real("rpe"),
    durationSeconds: integer("duration_seconds"), // time under load for the set
    // Reason chip from the "Adjust load" sheet when the athlete changed the
    // weight mid-set: "too_heavy" | "easy" | "niggle". Null = no reason given.
    // "niggle" is a pain signal, not a load signal — it is also POSTed to the
    // pain-log endpoint (see GuidedSession.tsx), which feeds the existing
    // Achilles/HSR pain gate (lib/strength/progression.ts evaluatePainGate).
    feel: text("feel"),
    // "warmup" | "working". Null means working, so every row logged before this
    // column existed keeps its current meaning. Warm-ups are excluded from the
    // progression signal: counting them made a light ramp set look like a
    // failed working set and pushed the suggested load DOWN.
    kind: text("kind"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("strength_sets_session_id_idx").on(t.sessionId),
    // One row per logged set — makes the API's upsert genuinely idempotent,
    // so a queued replay racing a live write can't duplicate it.
    uniqueIndex("strength_sets_session_exercise_set_uq").on(
      t.sessionId,
      t.exerciseId,
      t.setNumber
    ),
    index("strength_sets_exercise_id_idx").on(t.exerciseId),
  ]
);

// Daily check-in: readiness, bodyweight, and off-day/illness tracking. One row
// per calendar day (upserted). Feeds the Today view and readiness context.
export const wellnessLogs = pgTable(
  "wellness_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Uniqueness is (date, profile) via a raw expression index in 0005 —
    // COALESCE(profile_id, zero-uuid) — which Drizzle can't express here.
    date: timestamp("date", { withTimezone: true }).notNull(),
    // NULL = owner; set = household guest profile
    profileId: uuid("profile_id").references(() => profiles.id, {
      onDelete: "cascade",
    }),
    restDay: boolean("rest_day").notNull().default(false),
    illness: boolean("illness").notNull().default(false),
    injury: boolean("injury").notNull().default(false),
    bodyweightKg: real("bodyweight_kg"),
    energy: integer("energy"), // 1–5
    sleepQuality: integer("sleep_quality"), // 1–5
    soreness: integer("soreness"), // 1–5
    note: text("note"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id)
      .default(OWNER_USER_ID),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("wellness_logs_date_idx").on(t.date),
    index("wellness_logs_profile_id_idx").on(t.profileId),
    index("wellness_logs_user_id_idx").on(t.userId),
  ]
);

// Device-sourced overnight physiology, one row per calendar day (owner
// only — a household guest has no watch feeding this). Deliberately
// separate from wellnessLogs: that table is the athlete's own subjective
// check-in (sleep QUALITY, energy, soreness); this is what the watch
// measured (sleep DURATION, resting HR, HRV). Neither should overwrite the
// other — the readiness combine step reads both.
export const wellnessMetrics = pgTable(
  "wellness_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Midnight UTC of the calendar day this overnight reading belongs to
    // (Garmin's calendarDate), same normalize-to-midnight convention as
    // wellnessLogs.date so the two can be joined by day.
    date: timestamp("date", { withTimezone: true }).notNull(),
    sleepSeconds: integer("sleep_seconds"),
    restingHr: integer("resting_hr"),
    hrvLastNightAvg: integer("hrv_last_night_avg"),
    // Kept for reference only — readiness computes its own rolling baseline
    // from the history of hrvLastNightAvg rather than trusting this, but
    // it's useful context on the wellness screen and free to store.
    hrvWeeklyAvg: integer("hrv_weekly_avg"),
    hrvStatus: text("hrv_status"),
    source: text("source").notNull().default("garmin"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id)
      .default(OWNER_USER_ID),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // Unique on (source, date), not date alone — a second source (Apple
  // Health, Health Connect) writing the same calendar night must get its
  // own row instead of overwriting Garmin's. See drizzle/0049.
  //
  // Phase 3 has to widen this to (user_id, source, date): as written, two
  // users' watches reporting the same night would collide.
  (t) => [
    uniqueIndex("wellness_metrics_source_date_uq").on(t.source, t.date),
    index("wellness_metrics_user_id_idx").on(t.userId),
  ]
);

export const painLogs = pgTable(
  "pain_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => strengthSessions.id, { onDelete: "cascade" }),
    score: integer("score").notNull(), // 0–10
    timing: painTimingEnum("timing").notNull(),
    // next-day check-in: did the load settle within 24 h?
    settledWithin24h: boolean("settled_within_24h"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("pain_logs_session_id_idx").on(t.sessionId)]
);

// Recurring weekly strength schedule preferences (guided setup wizard).
// One row per profile (NULL = owner); the scheduler tops up planned sessions.
export const strengthPlanSettings = pgTable(
  "strength_plan_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id").references(() => profiles.id, {
      onDelete: "cascade",
    }),
    goal: text("goal").notNull().default("running_focus"), // running_focus | all_round
    durationMinutes: integer("duration_minutes").notNull().default(45),
    sessionsPerWeek: integer("sessions_per_week").notNull().default(2),
    ability: text("ability").notNull().default("intermediate"),
    availableDays: integer("available_days").array().notNull(), // 0=Sun … 6=Sat
    equipment: text("equipment").array().notNull(),
    active: boolean("active").notNull().default(true),
    // Standalone strength block (no running plan): how many weeks it runs and
    // when it started. Null when strength simply follows a running plan.
    blockWeeks: integer("block_weeks"),
    blockStartDate: timestamp("block_start_date", { withTimezone: true }),
    // Cold-start load personalisation (all nullable — existing rows and users
    // who skip these questions fall back to the global per-exercise defaults).
    // `ability` above doubles as lifting experience (beginner/intermediate/
    // advanced ≈ none/some/experienced) so it isn't duplicated here.
    bodyweightKg: real("bodyweight_kg"),
    sex: text("sex"), // "male" | "female" | "unspecified" | null = unanswered
    // Reported running complaints (Kraft setup, optional step) — drives which
    // programme the athlete gets (see lib/strength/schedule.ts rotationFor +
    // lib/strength/program.ts TARGETED_WORK). Null/empty = general runner
    // default, no targeted or Achilles work. Values are Complaint slugs (see
    // lib/strength/types.ts STRENGTH_COMPLAINTS).
    complaints: text("complaints").array(),
    // Preferred rest between sets (seconds). null = use the program's
    // per-exercise defaults; set = override every non-rehab exercise's rest so
    // the athlete's rest-timer choice is what the plan actually prescribes.
    restSeconds: integer("rest_seconds"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id)
      .default(OWNER_USER_ID),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("strength_plan_settings_profile_idx").on(t.profileId),
    index("strength_plan_settings_user_id_idx").on(t.userId),
  ]
);

// User-defined custom workout templates. Profile-scoped (NULL = owner).
export const customWorkoutTemplates = pgTable(
  "custom_workout_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // NULL = owner; set = household guest profile
    profileId: uuid("profile_id").references(() => profiles.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id)
      .default(OWNER_USER_ID),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("custom_workout_templates_profile_id_idx").on(t.profileId),
    index("custom_workout_templates_user_id_idx").on(t.userId),
  ]
);

// Exercises within a custom workout template.
export const customWorkoutSlots = pgTable(
  "custom_workout_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => customWorkoutTemplates.id, { onDelete: "cascade" }),
    exerciseSlug: text("exercise_slug").notNull(),
    sets: integer("sets").notNull().default(3),
    repLow: integer("rep_low").notNull(),
    repHigh: integer("rep_high").notNull(),
    weightKg: real("weight_kg"),
    restSeconds: integer("rest_seconds").notNull().default(90),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("custom_workout_slots_template_id_idx").on(t.templateId)]
);

// ── Push reminders ────────────────────────────────────────────────────────────

// One row per subscribed device (a single athlete can have phone + desktop
// both opted in). `endpoint` is unique per browser/device install — the
// primary key web-push itself uses to address a subscription, so it's also
// the natural de-dupe key when the same device re-subscribes.
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id)
      .default(OWNER_USER_ID),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("push_subscriptions_user_id_idx").on(t.userId)]
);

// One row per user (same convention as strength_plan_settings / the
// localStorage UserSettings mirror pattern). Lives in the DB, not just
// localStorage, because the cron reads it server-side with no browser
// involved.
export const reminderSettings = pgTable(
  "reminder_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    enabled: boolean("enabled").notNull().default(false),
    // Minutes before a workout's time_of_day to send the push.
    leadMinutes: integer("lead_minutes").notNull().default(30),
    // Used for workouts with a null time_of_day — never midnight (see the
    // time_of_day column comment on `workouts`).
    defaultTimeOfDay: text("default_time_of_day").notNull().default("07:00"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id)
      .default(OWNER_USER_ID),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("reminder_settings_user_id_uq").on(t.userId)]
);

// One row per workout a reminder was ever claimed for. The unique workout_id
// is the concurrency guard: two overlapping cron runs racing the same
// workout, one gets the row, the other gets zero rows back and moves on —
// never a second push. `status` records the outcome of the most recent
// attempt so a transient failure (network blip, 5xx) can be retried by a
// later run while the workout hasn't started yet, without ever re-sending a
// reminder that already got through (see lib/reminders/retry.ts).
export const reminderSendStatusEnum = pgEnum("reminder_send_status", [
  // Claimed, push attempt in flight (or the process died mid-attempt — see
  // the stale-claim handling in retry.ts, which treats an old-enough
  // "pending" the same as "failed" rather than leaking the claim forever).
  "pending",
  // Delivered to at least one subscription. Terminal — never retried.
  "sent",
  // Every attempted subscription errored, but not with a definitive
  // "gone" response — worth trying again inside the reminder window.
  "failed",
  // Every attempted subscription came back 404/410 (push.ts's `expired`).
  // Those subscriptions get removed by dispatch.ts same as before; the
  // claim itself is terminal since nothing was reachable.
  "permanent",
]);

export const sentReminders = pgTable(
  "sent_reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workoutId: uuid("workout_id")
      .notNull()
      .unique()
      .references(() => workouts.id, { onDelete: "cascade" }),
    status: reminderSendStatusEnum("status").notNull().default("sent"),
    attempts: integer("attempts").notNull().default(1),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id)
      .default(OWNER_USER_ID),
  },
  (t) => [index("sent_reminders_user_id_idx").on(t.userId)]
);

// ── Relations ─────────────────────────────────────────────────────────────────

export const plansRelations = relations(plans, ({ many }) => ({
  weeks: many(weeks),
  workouts: many(workouts),
}));

export const weeksRelations = relations(weeks, ({ one, many }) => ({
  plan: one(plans, { fields: [weeks.planId], references: [plans.id] }),
  workouts: many(workouts),
}));

export const workoutsRelations = relations(workouts, ({ one, many }) => ({
  week: one(weeks, { fields: [workouts.weekId], references: [weeks.id] }),
  plan: one(plans, { fields: [workouts.planId], references: [plans.id] }),
  blocks: many(blocks),
  activity: one(activities, {
    fields: [workouts.id],
    references: [activities.workoutId],
  }),
}));

export const blocksRelations = relations(blocks, ({ one }) => ({
  workout: one(workouts, {
    fields: [blocks.workoutId],
    references: [workouts.id],
  }),
}));

export const activitiesRelations = relations(activities, ({ one }) => ({
  workout: one(workouts, {
    fields: [activities.workoutId],
    references: [workouts.id],
  }),
}));

export const strengthExercisesRelations = relations(
  strengthExercises,
  ({ many }) => ({
    sets: many(strengthSets),
  })
);

export const strengthSessionsRelations = relations(
  strengthSessions,
  ({ one, many }) => ({
    plan: one(plans, {
      fields: [strengthSessions.planId],
      references: [plans.id],
    }),
    sets: many(strengthSets),
    painLogs: many(painLogs),
  })
);

export const strengthSetsRelations = relations(strengthSets, ({ one }) => ({
  session: one(strengthSessions, {
    fields: [strengthSets.sessionId],
    references: [strengthSessions.id],
  }),
  exercise: one(strengthExercises, {
    fields: [strengthSets.exerciseId],
    references: [strengthExercises.id],
  }),
}));

export const customWorkoutTemplatesRelations = relations(
  customWorkoutTemplates,
  ({ many }) => ({
    slots: many(customWorkoutSlots),
  })
);

export const customWorkoutSlotsRelations = relations(
  customWorkoutSlots,
  ({ one }) => ({
    template: one(customWorkoutTemplates, {
      fields: [customWorkoutSlots.templateId],
      references: [customWorkoutTemplates.id],
    }),
  })
);

export const painLogsRelations = relations(painLogs, ({ one }) => ({
  session: one(strengthSessions, {
    fields: [painLogs.sessionId],
    references: [strengthSessions.id],
  }),
}));

import { relations } from "drizzle-orm";
import {
  index,
  uniqueIndex,
  integer,
  jsonb,
  pgEnum,
  pgTable,
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
]);

// ── Tables ───────────────────────────────────────────────────────────────────

// Household members. The owner has NO row — a NULL profile_id on scoped tables
// means "the owner". Guest profiles (e.g. partner) get their own strength
// sessions and wellness logs, selected via the kadenz_profile cookie.
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  color: text("color"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    raceDistance: raceDistanceEnum("race_distance").notNull(),
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("plans_status_idx").on(t.status)]
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("weeks_plan_id_idx").on(t.planId),
    index("weeks_plan_week_idx").on(t.planId, t.weekNumber),
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
    gcalEventId: text("gcal_event_id"),
    garminWorkoutId: text("garmin_workout_id"),
    stravaActivityId: text("strava_activity_id"),
    sortOrder: integer("sort_order").notNull().default(0),
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("blocks_workout_id_idx").on(t.workoutId)]
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
    stravaId: text("strava_id").unique(),
    // Garmin activity id for watch-recorded activities imported via the
    // garmin-worker (stravaId stays null for those).
    garminId: text("garmin_id").unique(),
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("activities_workout_id_idx").on(t.workoutId),
    index("activities_strava_id_idx").on(t.stravaId),
    index("activities_strength_session_id_idx").on(t.strengthSessionId),
  ]
);

// Tombstones for user-deleted synced activities: sync (webhook + backfill)
// must never re-import these Strava ids.
export const deletedActivities = pgTable("deleted_activities", {
  stravaId: text("strava_id").primaryKey(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
});

// Recently deleted activities: full original row kept as jsonb for 30 days so
// deletes are recoverable. id is the original activities.id.
export const activityTrash = pgTable("activity_trash", {
  id: uuid("id").primaryKey(),
  payload: jsonb("payload").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
});

export const personalRecords = pgTable(
  "personal_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    distance: prDistanceEnum("distance").notNull(),
    timeSeconds: integer("time_seconds").notNull(),
    date: timestamp("date", { withTimezone: true }),
    source: prSourceEnum("source").notNull().default("race"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("personal_records_distance_idx").on(t.distance)]
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
  },
  (t) => [
    index("sync_outbox_status_idx").on(t.status),
    index("sync_outbox_entity_idx").on(t.entityType, t.entityId),
    index("sync_outbox_target_idx").on(t.target),
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
    sortOrder: integer("sort_order").notNull().default(0),
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("strength_plan_settings_profile_idx").on(t.profileId)]
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("custom_workout_templates_profile_id_idx").on(t.profileId)]
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

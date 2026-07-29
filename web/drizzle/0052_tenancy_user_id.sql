-- Phase 2 of the multi-user plan: tenancy columns.
--
-- Adds a user_id column to every table that holds a person's own data, and
-- backfills every existing row to the owner (see 0051_users.sql). This is
-- additive and idempotent: it rewrites the value of a NULL user_id, never an
-- existing non-null one, and every DDL statement below can run again on an
-- up-to-date database as a harmless no-op.
--
-- The DB-level DEFAULT of the owner id on every one of these columns is
-- deliberate and load-bearing, not a shortcut. Phase 2 does not touch the
-- ~62 query call sites that insert rows across the app, so none of them pass
-- user_id yet. Without a default, making the column NOT NULL here would break
-- every insert in the app today. Phase 3 is what sets user_id explicitly at
-- each call site and then drops these defaults. A default that silently
-- attributes every new row to the owner is exactly the wrong behaviour once
-- a second user exists, so it must not survive past Phase 3.
--
-- Statement order per table is deliberate: ADD COLUMN, SET DEFAULT, backfill,
-- SET NOT NULL. The default has to exist BEFORE the backfill runs. The
-- migration runner applies each statement on its own, with no surrounding
-- transaction, and Kadenz's cron sync and its Strava and Garmin webhooks do
-- not pause for a Vercel build. With the default set last, a row inserted in
-- the gap between the backfill and the default would land with a null
-- user_id, SET NOT NULL would fail, and the runner would abandon every table
-- after that one, leaving them untenanted while the build still went green.
-- With the default set first there is no such gap: anything written during
-- the migration gets the owner automatically.
--
-- Left untouched on purpose: users, user_identities (identity tables, not
-- tenanted data), strength_exercises (a shared catalogue, nobody's data), and
-- strength_sets / pain_logs / custom_workout_slots (each reachable only
-- through an already-tenanted parent row, strength_sessions or
-- custom_workout_templates, so tenancy on the parent is enough; Phase 3
-- decides whether to duplicate it onto the child for query convenience).

-- Refuse to backfill onto a user that does not exist. If this fires, 0051
-- has not been applied yet. Fix that before this file; do not let it run
-- past this guard and silently attribute data to a missing owner.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "users" WHERE "id" = '00000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'Owner user is missing, 0051 has not been applied. Refusing to backfill tenancy to a user that does not exist.';
  END IF;
END $$;
--> statement-breakpoint

-- plans
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "user_id" uuid;
--> statement-breakpoint
ALTER TABLE "plans" ALTER COLUMN "user_id" SET DEFAULT '00000000-0000-0000-0000-000000000001';
--> statement-breakpoint
UPDATE "plans" SET "user_id" = '00000000-0000-0000-0000-000000000001' WHERE "user_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "plans" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plans_user_id_fk') THEN
    ALTER TABLE "plans" ADD CONSTRAINT "plans_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plans_user_id_idx" ON "plans" ("user_id");
--> statement-breakpoint

-- weeks
ALTER TABLE "weeks" ADD COLUMN IF NOT EXISTS "user_id" uuid;
--> statement-breakpoint
ALTER TABLE "weeks" ALTER COLUMN "user_id" SET DEFAULT '00000000-0000-0000-0000-000000000001';
--> statement-breakpoint
UPDATE "weeks" SET "user_id" = '00000000-0000-0000-0000-000000000001' WHERE "user_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "weeks" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'weeks_user_id_fk') THEN
    ALTER TABLE "weeks" ADD CONSTRAINT "weeks_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "weeks_user_id_idx" ON "weeks" ("user_id");
--> statement-breakpoint

-- workouts
ALTER TABLE "workouts" ADD COLUMN IF NOT EXISTS "user_id" uuid;
--> statement-breakpoint
ALTER TABLE "workouts" ALTER COLUMN "user_id" SET DEFAULT '00000000-0000-0000-0000-000000000001';
--> statement-breakpoint
UPDATE "workouts" SET "user_id" = '00000000-0000-0000-0000-000000000001' WHERE "user_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "workouts" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workouts_user_id_fk') THEN
    ALTER TABLE "workouts" ADD CONSTRAINT "workouts_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workouts_user_id_idx" ON "workouts" ("user_id");
--> statement-breakpoint

-- blocks
ALTER TABLE "blocks" ADD COLUMN IF NOT EXISTS "user_id" uuid;
--> statement-breakpoint
ALTER TABLE "blocks" ALTER COLUMN "user_id" SET DEFAULT '00000000-0000-0000-0000-000000000001';
--> statement-breakpoint
UPDATE "blocks" SET "user_id" = '00000000-0000-0000-0000-000000000001' WHERE "user_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "blocks" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blocks_user_id_fk') THEN
    ALTER TABLE "blocks" ADD CONSTRAINT "blocks_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blocks_user_id_idx" ON "blocks" ("user_id");
--> statement-breakpoint

-- activities
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "user_id" uuid;
--> statement-breakpoint
ALTER TABLE "activities" ALTER COLUMN "user_id" SET DEFAULT '00000000-0000-0000-0000-000000000001';
--> statement-breakpoint
UPDATE "activities" SET "user_id" = '00000000-0000-0000-0000-000000000001' WHERE "user_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "activities" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activities_user_id_fk') THEN
    ALTER TABLE "activities" ADD CONSTRAINT "activities_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_user_id_idx" ON "activities" ("user_id");
--> statement-breakpoint

-- deleted_activities
ALTER TABLE "deleted_activities" ADD COLUMN IF NOT EXISTS "user_id" uuid;
--> statement-breakpoint
ALTER TABLE "deleted_activities" ALTER COLUMN "user_id" SET DEFAULT '00000000-0000-0000-0000-000000000001';
--> statement-breakpoint
UPDATE "deleted_activities" SET "user_id" = '00000000-0000-0000-0000-000000000001' WHERE "user_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "deleted_activities" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deleted_activities_user_id_fk') THEN
    ALTER TABLE "deleted_activities" ADD CONSTRAINT "deleted_activities_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deleted_activities_user_id_idx" ON "deleted_activities" ("user_id");
--> statement-breakpoint

-- activity_trash
ALTER TABLE "activity_trash" ADD COLUMN IF NOT EXISTS "user_id" uuid;
--> statement-breakpoint
ALTER TABLE "activity_trash" ALTER COLUMN "user_id" SET DEFAULT '00000000-0000-0000-0000-000000000001';
--> statement-breakpoint
UPDATE "activity_trash" SET "user_id" = '00000000-0000-0000-0000-000000000001' WHERE "user_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "activity_trash" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activity_trash_user_id_fk') THEN
    ALTER TABLE "activity_trash" ADD CONSTRAINT "activity_trash_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_trash_user_id_idx" ON "activity_trash" ("user_id");
--> statement-breakpoint

-- personal_records
ALTER TABLE "personal_records" ADD COLUMN IF NOT EXISTS "user_id" uuid;
--> statement-breakpoint
ALTER TABLE "personal_records" ALTER COLUMN "user_id" SET DEFAULT '00000000-0000-0000-0000-000000000001';
--> statement-breakpoint
UPDATE "personal_records" SET "user_id" = '00000000-0000-0000-0000-000000000001' WHERE "user_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "personal_records" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'personal_records_user_id_fk') THEN
    ALTER TABLE "personal_records" ADD CONSTRAINT "personal_records_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "personal_records_user_id_idx" ON "personal_records" ("user_id");
--> statement-breakpoint

-- sync_outbox
ALTER TABLE "sync_outbox" ADD COLUMN IF NOT EXISTS "user_id" uuid;
--> statement-breakpoint
ALTER TABLE "sync_outbox" ALTER COLUMN "user_id" SET DEFAULT '00000000-0000-0000-0000-000000000001';
--> statement-breakpoint
UPDATE "sync_outbox" SET "user_id" = '00000000-0000-0000-0000-000000000001' WHERE "user_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "sync_outbox" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sync_outbox_user_id_fk') THEN
    ALTER TABLE "sync_outbox" ADD CONSTRAINT "sync_outbox_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_outbox_user_id_idx" ON "sync_outbox" ("user_id");
--> statement-breakpoint

-- wellness_metrics
ALTER TABLE "wellness_metrics" ADD COLUMN IF NOT EXISTS "user_id" uuid;
--> statement-breakpoint
ALTER TABLE "wellness_metrics" ALTER COLUMN "user_id" SET DEFAULT '00000000-0000-0000-0000-000000000001';
--> statement-breakpoint
UPDATE "wellness_metrics" SET "user_id" = '00000000-0000-0000-0000-000000000001' WHERE "user_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "wellness_metrics" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wellness_metrics_user_id_fk') THEN
    ALTER TABLE "wellness_metrics" ADD CONSTRAINT "wellness_metrics_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wellness_metrics_user_id_idx" ON "wellness_metrics" ("user_id");
--> statement-breakpoint

-- push_subscriptions
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "user_id" uuid;
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ALTER COLUMN "user_id" SET DEFAULT '00000000-0000-0000-0000-000000000001';
--> statement-breakpoint
UPDATE "push_subscriptions" SET "user_id" = '00000000-0000-0000-0000-000000000001' WHERE "user_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_subscriptions_user_id_fk') THEN
    ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_user_id_idx" ON "push_subscriptions" ("user_id");
--> statement-breakpoint

-- reminder_settings (its unique index is created at the very end of this
-- file, not here, because it is the one statement that can legitimately fail)
ALTER TABLE "reminder_settings" ADD COLUMN IF NOT EXISTS "user_id" uuid;
--> statement-breakpoint
ALTER TABLE "reminder_settings" ALTER COLUMN "user_id" SET DEFAULT '00000000-0000-0000-0000-000000000001';
--> statement-breakpoint
UPDATE "reminder_settings" SET "user_id" = '00000000-0000-0000-0000-000000000001' WHERE "user_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "reminder_settings" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reminder_settings_user_id_fk') THEN
    ALTER TABLE "reminder_settings" ADD CONSTRAINT "reminder_settings_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");
  END IF;
END $$;
--> statement-breakpoint

-- sent_reminders
ALTER TABLE "sent_reminders" ADD COLUMN IF NOT EXISTS "user_id" uuid;
--> statement-breakpoint
ALTER TABLE "sent_reminders" ALTER COLUMN "user_id" SET DEFAULT '00000000-0000-0000-0000-000000000001';
--> statement-breakpoint
UPDATE "sent_reminders" SET "user_id" = '00000000-0000-0000-0000-000000000001' WHERE "user_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "sent_reminders" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sent_reminders_user_id_fk') THEN
    ALTER TABLE "sent_reminders" ADD CONSTRAINT "sent_reminders_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sent_reminders_user_id_idx" ON "sent_reminders" ("user_id");
--> statement-breakpoint

-- strength_sessions
ALTER TABLE "strength_sessions" ADD COLUMN IF NOT EXISTS "user_id" uuid;
--> statement-breakpoint
ALTER TABLE "strength_sessions" ALTER COLUMN "user_id" SET DEFAULT '00000000-0000-0000-0000-000000000001';
--> statement-breakpoint
UPDATE "strength_sessions" SET "user_id" = '00000000-0000-0000-0000-000000000001' WHERE "user_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "strength_sessions" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'strength_sessions_user_id_fk') THEN
    ALTER TABLE "strength_sessions" ADD CONSTRAINT "strength_sessions_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "strength_sessions_user_id_idx" ON "strength_sessions" ("user_id");
--> statement-breakpoint

-- wellness_logs
ALTER TABLE "wellness_logs" ADD COLUMN IF NOT EXISTS "user_id" uuid;
--> statement-breakpoint
ALTER TABLE "wellness_logs" ALTER COLUMN "user_id" SET DEFAULT '00000000-0000-0000-0000-000000000001';
--> statement-breakpoint
UPDATE "wellness_logs" SET "user_id" = '00000000-0000-0000-0000-000000000001' WHERE "user_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "wellness_logs" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wellness_logs_user_id_fk') THEN
    ALTER TABLE "wellness_logs" ADD CONSTRAINT "wellness_logs_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wellness_logs_user_id_idx" ON "wellness_logs" ("user_id");
--> statement-breakpoint

-- strength_plan_settings
ALTER TABLE "strength_plan_settings" ADD COLUMN IF NOT EXISTS "user_id" uuid;
--> statement-breakpoint
ALTER TABLE "strength_plan_settings" ALTER COLUMN "user_id" SET DEFAULT '00000000-0000-0000-0000-000000000001';
--> statement-breakpoint
UPDATE "strength_plan_settings" SET "user_id" = '00000000-0000-0000-0000-000000000001' WHERE "user_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "strength_plan_settings" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'strength_plan_settings_user_id_fk') THEN
    ALTER TABLE "strength_plan_settings" ADD CONSTRAINT "strength_plan_settings_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "strength_plan_settings_user_id_idx" ON "strength_plan_settings" ("user_id");
--> statement-breakpoint

-- custom_workout_templates
ALTER TABLE "custom_workout_templates" ADD COLUMN IF NOT EXISTS "user_id" uuid;
--> statement-breakpoint
ALTER TABLE "custom_workout_templates" ALTER COLUMN "user_id" SET DEFAULT '00000000-0000-0000-0000-000000000001';
--> statement-breakpoint
UPDATE "custom_workout_templates" SET "user_id" = '00000000-0000-0000-0000-000000000001' WHERE "user_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "custom_workout_templates" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'custom_workout_templates_user_id_fk') THEN
    ALTER TABLE "custom_workout_templates" ADD CONSTRAINT "custom_workout_templates_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "custom_workout_templates_user_id_idx" ON "custom_workout_templates" ("user_id");
--> statement-breakpoint

-- profiles
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "user_id" uuid;
--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "user_id" SET DEFAULT '00000000-0000-0000-0000-000000000001';
--> statement-breakpoint
UPDATE "profiles" SET "user_id" = '00000000-0000-0000-0000-000000000001' WHERE "user_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_user_id_fk') THEN
    ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profiles_user_id_idx" ON "profiles" ("user_id");
--> statement-breakpoint

-- reminder_settings stops being a singleton: one row per user rather than one
-- row for the whole app, so uniqueness moves to user_id.
--
-- Last statement in the file on purpose. It is the only one here that can
-- legitimately fail, because nothing ever enforced the "singleton" convention
-- in the database, so a second row could exist. The migration runner aborts
-- the rest of a file after a failed statement, and if this sat in its normal
-- position it would leave the six tables below it with no tenancy column at
-- all, on this deploy and every deploy after. Running last means a duplicate
-- costs only this index.
--
-- It warns rather than raising, for the same reason: a duplicate reminder row
-- is a thing to reconcile by hand, not a reason to withhold tenancy from the
-- whole database. Phase 3 must not enable row level security on this table
-- until the warning is gone.
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS "reminder_settings_user_id_uq"
    ON "reminder_settings" ("user_id");
EXCEPTION WHEN unique_violation THEN
  RAISE WARNING 'reminder_settings holds more than one row per user, so reminder_settings_user_id_uq was not created. Reconcile the duplicates by hand, then re-run this migration.';
END $$;

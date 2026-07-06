-- Strength module ("Kraft"): exercises, sessions, sets, pain logs.
-- Hand-authored and idempotent, matching the style of 0001.

-- ── Enums ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "public"."strength_category" AS ENUM('upper', 'lower', 'achilles');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."strength_session_type" AS ENUM('upper', 'lower', 'lower_achilles');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."pain_timing" AS ENUM('during', 'after', 'next_day');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- Strength sessions fan out to Google Calendar via the existing sync_outbox.
ALTER TYPE "public"."sync_entity_type" ADD VALUE IF NOT EXISTS 'strength_session';--> statement-breakpoint

-- ── Tables ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "strength_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"category" "strength_category" NOT NULL,
	"equipment_note" text,
	"tempo_note" text,
	"flat_ground_only" boolean DEFAULT false NOT NULL,
	"slow_progressor" boolean DEFAULT false NOT NULL,
	"default_sets" integer,
	"rep_low" integer,
	"rep_high" integer,
	"start_weight_kg" real,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strength_exercises_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "strength_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid,
	"date" timestamp with time zone NOT NULL,
	"day_of_week" integer NOT NULL,
	"type" "strength_session_type" NOT NULL,
	"title" text NOT NULL,
	"status" "workout_status" DEFAULT 'planned' NOT NULL,
	"target_duration_minutes" integer,
	"duration_minutes" integer,
	"notes" text,
	"gcal_event_id" text,
	"garmin_workout_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "strength_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"set_number" integer NOT NULL,
	"weight_kg" real,
	"reps" integer,
	"rpe" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "wellness_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"rest_day" boolean DEFAULT false NOT NULL,
	"illness" boolean DEFAULT false NOT NULL,
	"injury" boolean DEFAULT false NOT NULL,
	"bodyweight_kg" real,
	"energy" integer,
	"sleep_quality" integer,
	"soreness" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wellness_logs_date_unique" UNIQUE("date")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "pain_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"timing" "pain_timing" NOT NULL,
	"settled_within_24h" boolean,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- ── Foreign keys ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE "strength_sessions" ADD CONSTRAINT "strength_sessions_plan_id_plans_id_fk"
    FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "strength_sets" ADD CONSTRAINT "strength_sets_session_id_strength_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "public"."strength_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "strength_sets" ADD CONSTRAINT "strength_sets_exercise_id_strength_exercises_id_fk"
    FOREIGN KEY ("exercise_id") REFERENCES "public"."strength_exercises"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "pain_logs" ADD CONSTRAINT "pain_logs_session_id_strength_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "public"."strength_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "strength_exercises_category_idx" ON "strength_exercises" USING btree ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "strength_sessions_plan_id_idx" ON "strength_sessions" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "strength_sessions_date_idx" ON "strength_sessions" USING btree ("date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "strength_sessions_status_idx" ON "strength_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "strength_sessions_type_idx" ON "strength_sessions" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "strength_sets_session_id_idx" ON "strength_sets" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "strength_sets_exercise_id_idx" ON "strength_sets" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pain_logs_session_id_idx" ON "pain_logs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wellness_logs_date_idx" ON "wellness_logs" USING btree ("date");

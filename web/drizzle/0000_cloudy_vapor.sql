CREATE TYPE "public"."block_type" AS ENUM('warmup', 'work', 'recovery', 'cooldown');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('active', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."pr_distance" AS ENUM('5k', '10k', 'half', 'marathon', 'mile');--> statement-breakpoint
CREATE TYPE "public"."pr_source" AS ENUM('race', 'time_trial', 'estimate');--> statement-breakpoint
CREATE TYPE "public"."race_distance" AS ENUM('5k', '10k', 'half', 'marathon');--> statement-breakpoint
CREATE TYPE "public"."sync_action" AS ENUM('create', 'update', 'delete');--> statement-breakpoint
CREATE TYPE "public"."sync_entity_type" AS ENUM('workout', 'week', 'plan');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sync_target" AS ENUM('gcal', 'garmin');--> statement-breakpoint
CREATE TYPE "public"."training_difficulty" AS ENUM('easy', 'moderate', 'hard');--> statement-breakpoint
CREATE TYPE "public"."training_volume" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."week_phase" AS ENUM('base', 'build', 'peak', 'taper');--> statement-breakpoint
CREATE TYPE "public"."week_type" AS ENUM('normal', 'deload', 'race');--> statement-breakpoint
CREATE TYPE "public"."workout_status" AS ENUM('planned', 'completed', 'skipped', 'missed');--> statement-breakpoint
CREATE TYPE "public"."workout_type" AS ENUM('easy', 'long', 'tempo', 'interval', 'recovery', 'race', 'rest');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workout_id" uuid,
	"strava_id" text,
	"distance_km" real,
	"duration_seconds" integer,
	"avg_pace_sec_km" integer,
	"avg_hr" integer,
	"max_hr" integer,
	"splits_json" jsonb,
	"laps_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activities_strava_id_unique" UNIQUE("strava_id")
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workout_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"type" "block_type" NOT NULL,
	"duration_minutes" integer,
	"distance_km" real,
	"target_pace_sec_km" integer,
	"min_pace_sec_km" integer,
	"max_pace_sec_km" integer,
	"reps" integer,
	"rep_distance_km" real,
	"rep_rest_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personal_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"distance" "pr_distance" NOT NULL,
	"time_seconds" integer NOT NULL,
	"date" timestamp with time zone,
	"source" "pr_source" DEFAULT 'race' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"race_distance" "race_distance" NOT NULL,
	"goal_time_seconds" integer NOT NULL,
	"vdot" real NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"race_date" timestamp with time zone NOT NULL,
	"plan_length_weeks" integer NOT NULL,
	"days_per_week" integer NOT NULL,
	"preferred_long_run_day" integer,
	"week_start_day" integer DEFAULT 1 NOT NULL,
	"current_weekly_km" real,
	"training_volume" "training_volume" NOT NULL,
	"training_difficulty" "training_difficulty" NOT NULL,
	"long_run_cap_km" real,
	"hilly_area" boolean DEFAULT false NOT NULL,
	"status" "plan_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" "sync_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" "sync_action" NOT NULL,
	"target" "sync_target" NOT NULL,
	"payload" jsonb,
	"status" "sync_status" DEFAULT 'pending' NOT NULL,
	"idempotency_key" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "sync_outbox_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "weeks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"week_number" integer NOT NULL,
	"phase" "week_phase" NOT NULL,
	"type" "week_type" DEFAULT 'normal' NOT NULL,
	"target_km" real,
	"actual_km" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"type" "workout_type" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "workout_status" DEFAULT 'planned' NOT NULL,
	"target_km" real,
	"actual_km" real,
	"target_duration_minutes" integer,
	"gcal_event_id" text,
	"garmin_workout_id" text,
	"strava_activity_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weeks" ADD CONSTRAINT "weeks_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_week_id_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."weeks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_workout_id_idx" ON "activities" USING btree ("workout_id");--> statement-breakpoint
CREATE INDEX "activities_strava_id_idx" ON "activities" USING btree ("strava_id");--> statement-breakpoint
CREATE INDEX "blocks_workout_id_idx" ON "blocks" USING btree ("workout_id");--> statement-breakpoint
CREATE INDEX "personal_records_distance_idx" ON "personal_records" USING btree ("distance");--> statement-breakpoint
CREATE INDEX "plans_status_idx" ON "plans" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sync_outbox_status_idx" ON "sync_outbox" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sync_outbox_entity_idx" ON "sync_outbox" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "sync_outbox_target_idx" ON "sync_outbox" USING btree ("target");--> statement-breakpoint
CREATE INDEX "weeks_plan_id_idx" ON "weeks" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "weeks_plan_week_idx" ON "weeks" USING btree ("plan_id","week_number");--> statement-breakpoint
CREATE INDEX "workouts_week_id_idx" ON "workouts" USING btree ("week_id");--> statement-breakpoint
CREATE INDEX "workouts_plan_id_idx" ON "workouts" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "workouts_date_idx" ON "workouts" USING btree ("date");--> statement-breakpoint
CREATE INDEX "workouts_status_idx" ON "workouts" USING btree ("status");
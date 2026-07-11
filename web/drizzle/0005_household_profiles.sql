-- Household profiles: guest members (e.g. partner) get their own strength
-- sessions and wellness logs. profile_id NULL = the owner (existing data).
-- Idempotent: safe to re-run (applied automatically on every Vercel build).

CREATE TABLE IF NOT EXISTS "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "strength_sessions" ADD COLUMN IF NOT EXISTS "profile_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "strength_sessions" ADD CONSTRAINT "strength_sessions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "strength_sessions_profile_id_idx" ON "strength_sessions" USING btree ("profile_id");
--> statement-breakpoint
ALTER TABLE "wellness_logs" ADD COLUMN IF NOT EXISTS "profile_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "wellness_logs" ADD CONSTRAINT "wellness_logs_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wellness_logs_profile_id_idx" ON "wellness_logs" USING btree ("profile_id");
--> statement-breakpoint
-- One wellness row per calendar day PER PROFILE (was: unique per day globally).
ALTER TABLE "wellness_logs" DROP CONSTRAINT IF EXISTS "wellness_logs_date_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wellness_logs_date_profile_uq" ON "wellness_logs" ("date", COALESCE("profile_id", '00000000-0000-0000-0000-000000000000'::uuid));
--> statement-breakpoint
ALTER TYPE "public"."strength_session_type" ADD VALUE IF NOT EXISTS 'full_body';
--> statement-breakpoint
ALTER TYPE "public"."strength_category" ADD VALUE IF NOT EXISTS 'full_body';
--> statement-breakpoint
-- Seed the full-body exercise catalogue additions (idempotent via slug).
-- Runs in a separate autocommit statement AFTER the enum values above, so the
-- new 'full_body' category value is already committed.
INSERT INTO "strength_exercises" ("slug", "name", "category", "equipment_note", "tempo_note", "default_sets", "rep_low", "rep_high", "start_weight_kg", "sort_order")
VALUES
	('goblet_squat', 'Goblet squat', 'full_body', 'One dumbbell held at the chest', NULL, 3, 8, 12, 8, 20),
	('one_arm_row', 'One-arm dumbbell row', 'full_body', 'Support yourself on a chair or bench', 'Drive the elbow back, squeeze at top', 3, 8, 12, 10, 21),
	('glute_bridge', 'Glute bridge', 'full_body', 'Dumbbell resting on the hips', 'Pause and squeeze at the top', 3, 8, 12, 12.5, 22)
ON CONFLICT ("slug") DO NOTHING;

-- Custom workout templates (Phase 2). NULL profile_id = owner.
CREATE TABLE IF NOT EXISTS "custom_workout_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "profile_id" uuid REFERENCES "profiles"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "custom_workout_templates_profile_id_idx"
  ON "custom_workout_templates" ("profile_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "custom_workout_slots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "template_id" uuid NOT NULL REFERENCES "custom_workout_templates"("id") ON DELETE cascade,
  "exercise_slug" text NOT NULL,
  "sets" integer DEFAULT 3 NOT NULL,
  "rep_low" integer NOT NULL,
  "rep_high" integer NOT NULL,
  "weight_kg" real,
  "rest_seconds" integer DEFAULT 90 NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "custom_workout_slots_template_id_idx"
  ON "custom_workout_slots" ("template_id");
--> statement-breakpoint
-- Phase 1 added single_leg_rdl to the code catalogue and the lower templates,
-- but never seeded it — set logging resolves slug → id from this table and
-- 422s (silently, client-side) when missing. Seed it here.
INSERT INTO "strength_exercises" ("slug", "name", "category", "tempo_note", "default_sets", "rep_low", "rep_high", "start_weight_kg", "sort_order")
VALUES
	('single_leg_rdl', 'Single-leg Romanian deadlift', 'lower', 'Slow eccentric, 3-4 seconds down, hamstring stretch', 3, 15, 25, 15, 23)
ON CONFLICT ("slug") DO NOTHING;

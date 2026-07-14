-- Weekly strength schedule preferences (setup wizard) + auto-schedule marker.
CREATE TABLE IF NOT EXISTS "strength_plan_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "profile_id" uuid REFERENCES "profiles"("id") ON DELETE cascade,
  "goal" text DEFAULT 'running_focus' NOT NULL,
  "duration_minutes" integer DEFAULT 45 NOT NULL,
  "sessions_per_week" integer DEFAULT 2 NOT NULL,
  "ability" text DEFAULT 'intermediate' NOT NULL,
  "available_days" integer[] NOT NULL,
  "equipment" text[] NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "strength_plan_settings_profile_idx"
  ON "strength_plan_settings" ("profile_id");
--> statement-breakpoint
ALTER TABLE "strength_sessions" ADD COLUMN IF NOT EXISTS "auto_scheduled" boolean DEFAULT false NOT NULL;

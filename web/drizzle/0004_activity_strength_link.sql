-- Let recorded activities back a strength session and carry the Strava sport
-- type, for a unified run + strength activity feed. Idempotent.
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "strength_session_id" uuid;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "sport_type" text;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "activities" ADD CONSTRAINT "activities_strength_session_id_strength_sessions_id_fk"
    FOREIGN KEY ("strength_session_id") REFERENCES "public"."strength_sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "activities_strength_session_id_idx" ON "activities" USING btree ("strength_session_id");

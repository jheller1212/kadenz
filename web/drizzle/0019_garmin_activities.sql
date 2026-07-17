-- Garmin activity import: activities recorded on the watch arrive without a
-- Strava id, so they get their own external key for dedupe/tombstones.
-- (workouts.garmin_workout_id and strength_sessions.garmin_workout_id already
-- exist from 0000/0002.)
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "garmin_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "activities_garmin_id_unique" ON "activities" ("garmin_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_garmin_id_idx" ON "activities" ("garmin_id");

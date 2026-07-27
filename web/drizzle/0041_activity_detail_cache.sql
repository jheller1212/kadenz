-- Activity detail was refetching immutable Strava data (best efforts,
-- cadence, calories, device/gear names, and the HR/velocity/altitude/latlng
-- streams) on every single view. None of it changes once an activity has
-- synced, so it's cached here following the polyline precedent (0021):
-- populated for free at import time from the detail payload already fetched
-- there, and back-filled on first detail view for older rows / the streams
-- (which import doesn't fetch, to avoid doubling Strava calls per sync).
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "best_efforts_json" jsonb;
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "cadence_spm" integer;
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "calories" integer;
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "device_name" text;
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "gear_name" text;
--> statement-breakpoint
-- Streams are the bulk of the payload (heartrate/velocity/altitude/latlng
-- plus distance/time for their x-axes), at the same medium resolution
-- already requested live. Safe to store in the same row: every other query
-- against `activities` in this codebase selects explicit columns, never
-- `select *` over a list, so this doesn't inflate anything but a single
-- activity's own detail read, and Postgres TOASTs large jsonb out of line.
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "streams_json" jsonb;

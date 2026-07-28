-- Garmin push must only ever happen for sessions that belong to the ongoing
-- plan (scheduler-placed, or deliberately added to a date from Plan >
-- Rearrange) or via the athlete's explicit "Send to watch" control. A Kraft
-- picker "Start" or custom-workout quick-start must never reach the watch on
-- its own (see lib/sync/garmin-sync.ts). Default false so brand-new ad-hoc
-- sessions are excluded by default; backfill true for the rows the weekly
-- scheduler already placed so their existing window-sync/re-push behaviour
-- keeps working unchanged.
ALTER TABLE "strength_sessions" ADD COLUMN IF NOT EXISTS "watch_eligible" boolean NOT NULL DEFAULT false;
UPDATE "strength_sessions" SET "watch_eligible" = true WHERE "auto_scheduled" = true AND "watch_eligible" = false;

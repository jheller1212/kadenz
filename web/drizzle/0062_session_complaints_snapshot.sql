-- The complaints a strength session was built for, frozen once the athlete
-- starts it.
--
-- A session has no stored exercise list: the plan is rebuilt from its template
-- on every read (lib/strength/session.ts), and complaints are one of the
-- inputs. That is what makes a settings change reach the plan at all, and it
-- is what we want for a session nobody has touched yet. It is wrong for one
-- already under way or finished: an athlete who logs three sets of calf raises
-- and then turns the Achilles complaint off would reopen that session to find
-- the calf raises gone from the plan while their sets are still in
-- strength_sets, orphaned and invisible.
--
-- So a started session keeps the complaint set it was started with, and reads
-- use that instead of the current settings. NULL means "not started yet,
-- follow current settings", which is what every planned future session wants:
-- change the setting and the plan changes with it.

ALTER TABLE "strength_sessions" ADD COLUMN IF NOT EXISTS "complaints" text[];
--> statement-breakpoint

-- Backfill sessions that are already started or finished with the complaints
-- their profile reports right now. Those sessions were built under exactly
-- that set, so this pins them to what the athlete already saw. Without it the
-- first complaint change would rewrite the past: history would re-render with
-- work the athlete never did, or without work they logged sets for.
-- Still-planned, never-started sessions keep NULL on purpose.
UPDATE "strength_sessions" s
SET "complaints" = COALESCE(ps."complaints", ARRAY[]::text[])
FROM "strength_plan_settings" ps
WHERE ps."user_id" = s."user_id"
  AND ps."profile_id" IS NOT DISTINCT FROM s."profile_id"
  AND s."complaints" IS NULL
  AND (s."started_at" IS NOT NULL OR s."status" <> 'planned');

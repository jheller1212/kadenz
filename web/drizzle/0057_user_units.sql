-- The athlete's unit preference, server-side.
--
-- Until now "km or miles" and "kg or lbs" existed only in the kadenz_settings
-- localStorage blob, so anything Kadenz generates without a browser had no
-- way to read it. A miles athlete still got a km title on the watch, in the
-- Google Calendar event and in the push reminder, because those three are
-- built by the cron. Titles themselves are not the problem: they are rebuilt
-- from the workout's numeric fields (lib/plan-engine/workout-title.ts), which
-- needs a unit to rebuild them in.
--
-- On users rather than a settings table because it is a property of the
-- person, it is two columns, and every server surface that needs it already
-- has the user id in hand.
--
-- weight_unit is here for the same reason as distance_unit: the calendar
-- event for a strength session lists each exercise's load, so it needs to
-- know whether to write kg or lbs.
--
-- Defaults match the localStorage defaults, so an athlete who has never
-- opened the units screen sees exactly what they see today. The client keeps
-- its own copy and mirrors it here on change; this is the copy the server
-- reads, never the other way round.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "distance_unit" text NOT NULL DEFAULT 'km';
--> statement-breakpoint

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "weight_unit" text NOT NULL DEFAULT 'kg';
--> statement-breakpoint

-- Constrained rather than free text: these two values are read straight into
-- formatting helpers typed as unions, so a third value would silently format
-- as the fallback branch instead of failing where it was written.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_distance_unit_check') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_distance_unit_check"
      CHECK ("distance_unit" IN ('km', 'miles'));
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_weight_unit_check') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_weight_unit_check"
      CHECK ("weight_unit" IN ('kg', 'lbs'));
  END IF;
END $$;

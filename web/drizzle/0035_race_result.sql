-- Explicit race-result capture. A real race is the single most informative
-- data point the athlete gives the app, and until now nothing recorded it —
-- a race plan simply ran past its race day and stopped mattering.
--
-- These live on `workouts` (the race-day workout itself, type "race") rather
-- than a new table: there's exactly one race workout per race plan, and
-- keeping the result next to it means one row to read for the post-race
-- screen. Kept separate from actualDurationSeconds/actualKm — those are
-- filled by any completed workout (guided run, synced activity) — so a race
-- result is unambiguous evidence, not inferred from "some duration got set".
ALTER TABLE "workouts" ADD COLUMN IF NOT EXISTS "race_finish_seconds" integer;
ALTER TABLE "workouts" ADD COLUMN IF NOT EXISTS "race_feel" text;
ALTER TABLE "workouts" ADD COLUMN IF NOT EXISTS "race_result_logged_at" timestamp with time zone;

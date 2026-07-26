-- Optional time-of-day for a workout, separate from its date.
--
-- Stored as "HH:mm" (24h, local). Null means "no specific time" — the workout
-- detail screen and the Google Calendar sync must never read a null time as
-- midnight, only as "unset".
ALTER TABLE "workouts" ADD COLUMN IF NOT EXISTS "time_of_day" text;

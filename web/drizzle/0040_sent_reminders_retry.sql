-- A claimed-but-unsent reminder used to be permanent: the unique workout_id
-- row was inserted before the push attempt, so a transient network blip or
-- 5xx left the claim in place forever with no retry and no signal. This adds
-- an explicit outcome per claim so a later cron run (every 15 min) can retry
-- a transient failure while the workout's reminder window is still open,
-- while a definitive outcome (sent, or every subscription permanently gone)
-- stays terminal. See lib/reminders/retry.ts for the pure eligibility rule.
--
-- Existing rows predate this column and, under the old code, only ever
-- existed when a send was attempted; they're backfilled as 'sent' since that
-- is the closest honest default and their workouts have long since started
-- (so selectDueReminders would never consider them for a retry anyway).
DO $$ BEGIN
  CREATE TYPE "reminder_send_status" AS ENUM ('pending', 'sent', 'failed', 'permanent');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "sent_reminders" ADD COLUMN IF NOT EXISTS "status" "reminder_send_status" NOT NULL DEFAULT 'sent';
--> statement-breakpoint
ALTER TABLE "sent_reminders" ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "sent_reminders" ADD COLUMN IF NOT EXISTS "last_attempt_at" timestamp with time zone NOT NULL DEFAULT now();

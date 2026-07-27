-- Web push infrastructure for workout reminders. Three tables:
--   push_subscriptions — one row per subscribed device (phone + desktop can
--     both be opted in for the same athlete).
--   reminder_settings — singleton row (single-athlete app), read by the cron
--     server-side, so the toggle/lead-time isn't trapped in localStorage.
--   sent_reminders — one row per workout a reminder actually went out for;
--     the unique workout_id is what makes a cron re-run a no-op.
-- Idempotent.

CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "endpoint" text NOT NULL UNIQUE,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "reminder_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "enabled" boolean NOT NULL DEFAULT false,
  "lead_minutes" integer NOT NULL DEFAULT 30,
  "default_time_of_day" text NOT NULL DEFAULT '07:00',
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "sent_reminders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workout_id" uuid NOT NULL UNIQUE REFERENCES "workouts"("id") ON DELETE CASCADE,
  "sent_at" timestamp with time zone NOT NULL DEFAULT now()
);

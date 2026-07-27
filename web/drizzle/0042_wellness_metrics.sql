-- Device-sourced overnight physiology (sleep duration, resting HR, HRV) for
-- readiness. One row per calendar day, upserted daily by the Garmin wellness
-- sync (see web/src/lib/sync/wellness-sync.ts). Deliberately separate from
-- wellness_logs: that table is the athlete's own subjective check-in, this
-- is what the watch measured. Idempotent.
CREATE TABLE IF NOT EXISTS "wellness_metrics" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "date" timestamp with time zone NOT NULL,
  "sleep_seconds" integer,
  "resting_hr" integer,
  "hrv_last_night_avg" integer,
  "hrv_weekly_avg" integer,
  "hrv_status" text,
  "source" text NOT NULL DEFAULT 'garmin',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wellness_metrics_date_uq" ON "wellness_metrics" ("date");

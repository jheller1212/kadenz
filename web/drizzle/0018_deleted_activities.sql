CREATE TABLE IF NOT EXISTS "deleted_activities" (
  "strava_id" text PRIMARY KEY,
  "deleted_at" timestamp with time zone NOT NULL DEFAULT now()
);

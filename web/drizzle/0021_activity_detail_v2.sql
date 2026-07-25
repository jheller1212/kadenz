-- Activity detail v2: route map hero + cached AI insight.
-- polyline: Strava map.summary_polyline, saved on import and back-filled on
-- first detail view for older rows. ai_insight: generated once per activity
-- via the insights endpoint; regenerate overwrites it.
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "polyline" text;
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "ai_insight" text;
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "ai_insight_generated_at" timestamp with time zone;

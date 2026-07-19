ALTER TABLE "strength_plan_settings" ADD COLUMN IF NOT EXISTS "block_weeks" integer;
--> statement-breakpoint
ALTER TABLE "strength_plan_settings" ADD COLUMN IF NOT EXISTS "block_start_date" timestamp with time zone;

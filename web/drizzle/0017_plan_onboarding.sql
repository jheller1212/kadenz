ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "runner_level" text;
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "available_days" jsonb;

ALTER TABLE "strength_plan_settings" ADD COLUMN IF NOT EXISTS "bodyweight_kg" real;
--> statement-breakpoint
ALTER TABLE "strength_plan_settings" ADD COLUMN IF NOT EXISTS "sex" text;

-- F-03: Add missing training_volume enum values
ALTER TYPE "public"."training_volume" ADD VALUE IF NOT EXISTS 'beginner' BEFORE 'low';
ALTER TYPE "public"."training_volume" ADD VALUE IF NOT EXISTS 'elite' AFTER 'high';

-- F-04: Add missing columns to activities table
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "start_date" timestamp with time zone;
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "elevation_gain" real;
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "max_elevation" real;

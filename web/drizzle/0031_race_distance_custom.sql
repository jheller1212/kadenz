-- Custom race distance: a new enum value + a column to hold the chosen km.
-- ADD VALUE runs outside a transaction and IF NOT EXISTS keeps it idempotent;
-- the column is additive + nullable. The value is only READ by later plans, not
-- used within this migration, so adding it here is safe.
ALTER TYPE "race_distance" ADD VALUE IF NOT EXISTS 'custom';
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "custom_distance_km" real;

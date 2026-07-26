-- Lets an athlete drop a lost base/build week (illness/travel/injury) instead
-- of falling behind or abandoning the plan. Deliberately does NOT touch
-- week_number, phase, or any workout date on other weeks — see the comment on
-- weeks.skipped_at in schema.ts for why (date-derived week lookups elsewhere
-- assume an un-shifted, contiguous week-number-from-startDate mapping).
-- Idempotent.
ALTER TABLE "weeks" ADD COLUMN IF NOT EXISTS "skipped_at" timestamp with time zone;
ALTER TABLE "weeks" ADD COLUMN IF NOT EXISTS "skip_reason" text;
ALTER TABLE "weeks" ADD COLUMN IF NOT EXISTS "skip_snapshot" jsonb;

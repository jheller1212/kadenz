-- Household profiles are now soft-deleted: "Remove" flips this flag instead
-- of dropping the row, so a stray or malformed delete can never cascade away
-- a household member's strength sessions, check-ins and custom workouts.
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "active" boolean NOT NULL DEFAULT true;

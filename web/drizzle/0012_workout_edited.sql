-- Flag hand-tuned workouts (distance/pace overrides survive visually as an
-- "Edited" badge; plan regeneration replaces all workouts regardless).
ALTER TABLE "workouts" ADD COLUMN IF NOT EXISTS "edited" boolean NOT NULL DEFAULT false;

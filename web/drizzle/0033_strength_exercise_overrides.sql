ALTER TABLE "strength_sessions" ADD COLUMN IF NOT EXISTS "exercise_overrides" jsonb NOT NULL DEFAULT '[]';

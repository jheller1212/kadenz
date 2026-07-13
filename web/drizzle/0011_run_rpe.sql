-- Post-run RPE (Borg 0-10) on workouts; feeds the readiness score.
ALTER TABLE "workouts" ADD COLUMN IF NOT EXISTS "rpe" real;

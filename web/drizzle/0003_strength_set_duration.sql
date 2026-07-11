-- Per-set time under load for the guided session. Idempotent.
ALTER TABLE "strength_sets" ADD COLUMN IF NOT EXISTS "duration_seconds" integer;

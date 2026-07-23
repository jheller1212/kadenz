-- Persist the elapsed time of a guided phone run so it isn't lost the way it
-- was before (only actual_km was stored). Additive + nullable + idempotent, so
-- re-running on an up-to-date database is a harmless no-op.
ALTER TABLE "workouts" ADD COLUMN IF NOT EXISTS "actual_duration_seconds" integer;

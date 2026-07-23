-- Add the "ultra" (50K) race distance to the enum. ADD VALUE runs outside a
-- transaction (migrate.mjs executes each statement individually via sql.unsafe,
-- so this is fine) and IF NOT EXISTS keeps it idempotent.
ALTER TYPE "race_distance" ADD VALUE IF NOT EXISTS 'ultra';

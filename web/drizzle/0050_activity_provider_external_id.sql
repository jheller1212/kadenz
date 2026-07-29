-- Today `activities` has one unique column per provider (strava_id,
-- garmin_id). A third source (Apple Health, Health Connect, ...) would need
-- a fourth column, and every reader would need to learn one more branch.
-- Replace that shape going forward with a generic (provider, external_id)
-- pair, while leaving strava_id/garmin_id populated and readable exactly as
-- they are today — too much existing code (and another agent working in
-- parallel) still depends on them, and this migration must stay additive.
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "provider" text;
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "external_id" text;
--> statement-breakpoint

-- Backfill from the existing columns. Guarded by "provider IS NULL" so a
-- re-run (this script re-applies every file on every build) is a no-op once
-- a row has been backfilled, and so it never clobbers a value written by the
-- new dual-write code paths in the meantime.
UPDATE "activities" SET "provider" = 'strava', "external_id" = "strava_id"
  WHERE "strava_id" IS NOT NULL AND "provider" IS NULL;
--> statement-breakpoint
UPDATE "activities" SET "provider" = 'garmin', "external_id" = "garmin_id"
  WHERE "garmin_id" IS NOT NULL AND "provider" IS NULL;
--> statement-breakpoint

-- A collision on (provider, external_id) is not possible from this backfill:
-- strava_id and garmin_id each already carry their own unique index, and a
-- row can only ever match one of the two WHERE clauses above (a row with
-- both a strava_id and a garmin_id would be backfilled from strava_id only,
-- same as it is today where the two ids are treated as mutually exclusive
-- provider origins). So there is no existing data to violate the unique
-- index created below.
--
-- The index is partial (WHERE provider IS NOT NULL AND external_id IS NOT
-- NULL) so manually created activities, which have neither, are excluded.
-- Postgres unique indexes already treat NULL as never colliding with NULL,
-- so the partial WHERE is not strictly required for correctness here — it
-- is kept anyway to state that intent explicitly rather than rely on that
-- implicit behaviour.
CREATE UNIQUE INDEX IF NOT EXISTS "activities_provider_external_id_uq"
  ON "activities" ("provider", "external_id")
  WHERE "provider" IS NOT NULL AND "external_id" IS NOT NULL;

-- Phase 4 of the multi-user plan: per-user integration state.
--
-- Two pieces of sync bookkeeping were also single global rows in sync_outbox,
-- addressed by a fixed idempotency key:
--
--   garmin:import:singleton  the activity-import bookmark (lastImportAt)
--   garmin:config:singleton  the "send workouts to the watch" toggle
--
-- The bookmark is the damaging one. Under a per-user import each iteration
-- would write its own position into the same row, so the next user's import
-- would start from wherever the previous user's import finished. Depending on
-- who ran last, an athlete either re-imports weeks of activities or skips the
-- ones recorded since their own last run. The toggle is the same shape with a
-- milder failure: one person turning watch sync off turned it off for
-- everyone.
--
-- A key/value table rather than a column per setting, because both values are
-- small opaque blobs that only their own reader understands, and adding the
-- next one should not be another migration.
--
-- Additive: the old singleton rows are copied, never deleted (see 0058).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "users" WHERE "id" = '00000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'Owner user is missing, 0051 has not been applied. Refusing to backfill sync state to a user that does not exist.';
  END IF;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "user_integration_state" (
  "user_id" uuid NOT NULL,
  "key" text NOT NULL,
  "value" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_integration_state_pk" PRIMARY KEY ("user_id", "key")
);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_integration_state_user_id_fk') THEN
    ALTER TABLE "user_integration_state"
      ADD CONSTRAINT "user_integration_state_user_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint

-- Backfill the owner's import bookmark. Losing this would make the next
-- import fall back to the 30-day default lookback and re-walk a month of
-- activities, which the garmin_id dedupe survives but which is a slow and
-- noisy first run for no reason.
INSERT INTO "user_integration_state" ("user_id", "key", "value")
SELECT '00000000-0000-0000-0000-000000000001', 'garmin:import', "payload"
FROM "sync_outbox"
WHERE "idempotency_key" = 'garmin:import:singleton'
  AND "payload" IS NOT NULL
ON CONFLICT ("user_id", "key") DO NOTHING;
--> statement-breakpoint

INSERT INTO "user_integration_state" ("user_id", "key", "value")
SELECT '00000000-0000-0000-0000-000000000001', 'garmin:config', "payload"
FROM "sync_outbox"
WHERE "idempotency_key" = 'garmin:config:singleton'
  AND "payload" IS NOT NULL
ON CONFLICT ("user_id", "key") DO NOTHING;

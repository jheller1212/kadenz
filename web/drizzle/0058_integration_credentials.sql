-- Phase 4 of the multi-user plan: per-user OAuth credentials.
--
-- Strava and Google tokens lived in ONE row of sync_outbox, addressed by a
-- fixed idempotency key ('strava:tokens:singleton', 'gcal:tokens:singleton').
-- idempotency_key is UNIQUE across the whole table, so the upsert in
-- saveTokens() could only ever produce a single row for the entire
-- installation. The second person to finish OAuth overwrote the first
-- person's tokens, and from then on the first person's sync read and wrote
-- the second person's Strava account. This table replaces that row with one
-- row per (user, provider).
--
-- provider_account_id is stored as its own indexed column rather than left
-- inside the payload because the Strava webhook is the one caller that has no
-- session: its event body names the athlete (owner_id) and nothing else, so
-- resolving "whose activity is this" has to be an indexed lookup on the
-- athlete id. Reading it out of jsonb would work and would also mean a table
-- scan on every webhook delivery.
--
-- Additive on purpose. The old sync_outbox singleton rows are COPIED, never
-- deleted or rewritten, so the owner's live connection survives this
-- migration whichever order the code and the SQL reach production in, and a
-- revert of the code still finds its tokens where it left them. Cleaning them
-- up is a separate, later decision.

-- Refuse to backfill onto a user that does not exist (see 0052 for the same
-- guard and why it is first).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "users" WHERE "id" = '00000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'Owner user is missing, 0051 has not been applied. Refusing to backfill credentials to a user that does not exist.';
  END IF;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "integration_credentials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "provider" text NOT NULL,
  "provider_account_id" text,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- One connection per provider per person. This is the constraint the whole
-- fix rests on: it is what makes the upsert in saveTokens() land on the
-- caller's own row instead of on the installation's only row.
CREATE UNIQUE INDEX IF NOT EXISTS "integration_credentials_user_provider_uq"
  ON "integration_credentials" ("user_id", "provider");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "integration_credentials_provider_account_idx"
  ON "integration_credentials" ("provider", "provider_account_id");
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integration_credentials_user_id_fk') THEN
    ALTER TABLE "integration_credentials"
      ADD CONSTRAINT "integration_credentials_user_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint

-- Backfill: the owner's existing Strava connection. INSERT ... SELECT with no
-- matching source row is a no-op, so an installation that never connected
-- Strava skips this without erroring, and ON CONFLICT DO NOTHING means a
-- re-run (or a connection already re-established by the new code) is never
-- overwritten with the older singleton payload.
INSERT INTO "integration_credentials" ("user_id", "provider", "provider_account_id", "payload")
SELECT
  '00000000-0000-0000-0000-000000000001',
  'strava',
  "payload" ->> 'athlete_id',
  "payload"
FROM "sync_outbox"
WHERE "idempotency_key" = 'strava:tokens:singleton'
  AND "payload" IS NOT NULL
ON CONFLICT ("user_id", "provider") DO NOTHING;
--> statement-breakpoint

INSERT INTO "integration_credentials" ("user_id", "provider", "provider_account_id", "payload")
SELECT
  '00000000-0000-0000-0000-000000000001',
  'google',
  NULL,
  "payload"
FROM "sync_outbox"
WHERE "idempotency_key" = 'gcal:tokens:singleton'
  AND "payload" IS NOT NULL
ON CONFLICT ("user_id", "provider") DO NOTHING;

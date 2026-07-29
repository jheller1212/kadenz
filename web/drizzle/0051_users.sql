-- Phase 1 of the multi-user plan: real identity.
--
-- Until now a session cookie proved only that a browser held a signed value,
-- never who that browser belonged to. These two tables give Kadenz a subject:
-- `users` is the person, `user_identities` is each OAuth account that proves
-- they are that person. They are separate because one person can log in with
-- both Strava and Google, and both must land on the same user rather than
-- creating two accounts holding half the training data each.
--
-- Nothing opens up here. The allowlist in web/src/lib/owner.ts is unchanged
-- and is still the only thing that decides who may log in at all.

CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" text,
  "display_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "user_identities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  -- "strava" | "google"
  "provider" text NOT NULL,
  -- Strava athlete id, or the Google subject claim. Stable per provider.
  "provider_account_id" text NOT NULL,
  "email" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_login_at" timestamp with time zone
);
--> statement-breakpoint

-- One account belongs to exactly one user. This is the lookup the OAuth
-- callback does on every login, and the guard that stops a second row being
-- created for an account that has logged in before.
CREATE UNIQUE INDEX IF NOT EXISTS "user_identities_provider_account_uq"
  ON "user_identities" ("provider", "provider_account_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "user_identities_user_id_idx"
  ON "user_identities" ("user_id");
--> statement-breakpoint

-- The existing athlete becomes user 1. The id is a fixed constant rather than
-- a generated one so that the Phase 2 backfill, the e2e seed and the app all
-- name the same row without having to read it back from anywhere.
-- Kept in sync with OWNER_USER_ID in web/src/db/schema.ts.
INSERT INTO "users" ("id", "display_name")
VALUES ('00000000-0000-0000-0000-000000000001', 'Owner')
ON CONFLICT ("id") DO NOTHING;

-- Storage for email magic-link sign-in (PLAN_OF_ATTACK.md 2.5, third
-- provider after Strava and Google).
--
-- No user_id column, on purpose. A request for a link happens before we know
-- whether the address belongs to anyone, and telling the two cases apart is
-- exactly the leak this feature must not have (see lib/email/tokens.ts). So
-- this table is identity infrastructure, the same category as
-- user_identities, and for the same reason it carries no row level security
-- policy and is excluded from nothing in the coverage migration -- that
-- migration's discovery query only ever matches tables with a user_id
-- column, and this one has none. It was renumbered from 0066 to 0068 to sort
-- after this file, per its own "must sort last" rule.
--
-- token_hash, never the raw token. A leaked row must not be a working link.
-- The hash is HMAC-SHA256 over the raw token using SESSION_SECRET (the same
-- secret and primitive session.ts already signs cookies with), not a bare
-- SHA-256, so a stolen database still cannot forge a valid hash for a
-- token an attacker picks.
CREATE TABLE IF NOT EXISTS "email_login_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- Normalized lower-case, trimmed -- see lib/email/tokens.ts. Matched
  -- exactly on consume, so it must be stored the same way it is compared.
  "email" text NOT NULL,
  "token_hash" text NOT NULL,
  -- The requester's IP, best-effort from X-Forwarded-For. Used only for the
  -- per-IP rate limit window below; never shown to anyone.
  "requested_ip" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- Minutes, not days -- EMAIL_TOKEN_TTL_MS in lib/email/tokens.ts is the
  -- single definition of how long that is; this column just stores the
  -- computed deadline so a stolen row cannot be replayed after the fact.
  "expires_at" timestamp with time zone NOT NULL,
  -- NULL until consumed. Set exactly once, by an UPDATE ... WHERE
  -- consumed_at IS NULL that also checks the id, so two concurrent consume
  -- requests for the same token race on that WHERE clause and only one can
  -- ever win -- single use enforced by the database, not by application code
  -- remembering to check first.
  "consumed_at" timestamp with time zone
);
--> statement-breakpoint

-- Rate limiting reads recent rows for one address or one IP (see
-- lib/email/rate-limit.ts) -- both need an index or every request-a-link call
-- becomes a sequential scan of the whole table.
CREATE INDEX IF NOT EXISTS "email_login_tokens_email_created_idx"
  ON "email_login_tokens" ("email", "created_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "email_login_tokens_ip_created_idx"
  ON "email_login_tokens" ("requested_ip", "created_at");
--> statement-breakpoint

-- The consume route narrows to one address's still-live tokens (from the
-- link's own query string) before doing a constant-time compare over that
-- small set -- see lib/email/tokens.ts for why it is not a direct lookup by
-- token_hash equality.
CREATE INDEX IF NOT EXISTS "email_login_tokens_email_live_idx"
  ON "email_login_tokens" ("email")
  WHERE "consumed_at" IS NULL;

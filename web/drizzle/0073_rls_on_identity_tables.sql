-- ── Close the tables PostgREST could read ───────────────────────────────────
--
-- Supabase's security advisor flagged four public tables with row level
-- security disabled, and it was not theoretical: with the project URL and the
-- publishable key — which is public by design, it ships in browser clients —
-- an anonymous caller could SELECT, INSERT, UPDATE, DELETE and TRUNCATE all
-- four over PostgREST. Verified against production before the fix, using
-- strength_exercises rather than the sensitive ones.
--
-- The worst of them is email_login_tokens. Those are magic-link login tokens:
-- reading one is signing in as its owner. users and user_identities are the
-- identity graph. strength_exercises is only the exercise catalogue, but there
-- is no reason for the world to be able to TRUNCATE it either.
--
-- ── Why this was missed, which matters more than the fix ────────────────────
--
-- These three are on rls-coverage.spec.ts's NON_TENANTED_EXCEPTIONS list, and
-- for a good reason: withUser() and the OAuth callback both read `users`
-- BEFORE any request context exists, so a per-user policy cannot apply and
-- FORCE landing on them would deadlock login itself. That reasoning is still
-- correct — and it silently answered a different question than the one that
-- mattered. "No per-user policy makes sense here" is not "nobody outside the
-- app can read this". The first is about policies; the second is about who can
-- reach the table at all.
--
-- It held right up until the database moved to Supabase, which exposes every
-- public table through PostgREST with grants to anon and authenticated. The
-- threat model changed and this list was never revisited.
--
-- ── ENABLE, deliberately NOT FORCE ──────────────────────────────────────────
--
-- All four are owned by kadenz_app, the role the app connects as, and Postgres
-- exempts a table's owner from ENABLE-only row level security. So:
--
--   the app (owner)            -> unaffected, reads exactly as before
--   anon / authenticated       -> subject to RLS, and with no policies, get
--                                 nothing at all
--
-- FORCE would break login for the reason the exceptions list already gives.
-- ENABLE is the whole fix, and it is why this migration adds no policies: a
-- deny-all is the intended end state, not an oversight. Supabase's linter will
-- report "RLS enabled, no policy" at INFO level for these forever; that is the
-- correct reading of a table nothing but the owner may touch.
--
-- The REVOKEs are belt and braces. The app never authenticates as anon or
-- authenticated, so those grants bought nothing and cost everything.

-- Guarded: anon/authenticated are Supabase's roles and do not exist in the
-- embedded Postgres the e2e suite applies these migrations to. An unguarded
-- REVOKE would abort the whole migration there, turning a security fix into a
-- broken test suite.
DO $$
DECLARE
  t text;
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY ARRAY[
        'email_login_tokens', 'users', 'user_identities', 'strength_exercises'
      ] LOOP
        EXECUTE format('REVOKE ALL ON public.%I FROM %I', t, r);
      END LOOP;
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.email_login_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strength_exercises ENABLE ROW LEVEL SECURITY;

-- Row level security for every tenanted table, discovered rather than listed.
--
-- ── The hole this closes ─────────────────────────────────────────────────────
--
-- 0053_rls.sql applies policies from a hardcoded array of table names. That was
-- honest at the time and it is checked by a test, but it has one failure mode
-- that no amount of care removes: a table added by a LATER migration is not in
-- that array, so it gets no policy.
--
-- A tenanted table with no policy is readable by everyone. Nothing fails. The
-- column is there, it is NOT NULL, it has no default, every insert sets it
-- correctly, the tests pass and the app works. The table is simply visible to
-- every user, invisibly.
--
-- That is not hypothetical. The phase 4 work adds `integration_credentials`
-- (OAuth access and refresh tokens) and `user_integration_state`, both carrying
-- `user_id`, in migrations that run after 0053. Shipping them under 0053 alone
-- would have published one athlete's refresh tokens to every other athlete, and
-- a leaked refresh token is durable access rather than a single response. It is
-- strictly worse than any of the 37 route leaks phase 3 set out to close.
--
-- ── Why this file is data-driven and 0053 is not ─────────────────────────────
--
-- It discovers its own list: every table in the public schema carrying a
-- `user_id` column, minus a short, named exclusion list. So a tenanted table
-- added by any migration, in any later phase, is covered without anyone
-- remembering to come back here.
--
-- It sorts last on purpose. Both scripts/migrate.mjs and e2e/apply-rls.ts order
-- by filename, so a file numbered above every table-creating migration sees
-- every table those migrations created, including ones written after this
-- comment. Adding the two phase 4 tables to 0053 instead would not work: 0053
-- runs before the migrations that create them, and on a fresh database it would
-- fail outright.
--
-- Keep this the highest-numbered enforcement migration. A new migration that
-- creates a tenanted table and sorts ABOVE this one would be uncovered for one
-- deploy. src/db/__tests__/tenancy.test.ts fails the build if a tenanted table
-- in the drizzle schema is not covered here, so that mistake is caught before
-- it ships rather than after.
--
-- 0053 is deliberately left as it is rather than rewritten. It documents the
-- reasoning for FORCE, for the predicate, and for the three child tables that
-- have no user_id of their own and are governed by joining to their parent.
-- Re-running both is harmless: everything below is idempotent, and the policy
-- definitions are identical.

DO $$
DECLARE
  t text;
  -- Tables that carry a `user_id` column but are NOT tenanted data.
  --
  -- The list is short and every entry needs a reason, because every entry is a
  -- table that will have no policy. Read as: "user_id here does not mean this
  -- row belongs to one athlete's training data".
  --
  --   user_identities: identity, not data. It maps an OAuth account to a user,
  --     and withUser plus the OAuth callback both have to read it BEFORE any
  --     context exists. A policy here would be a chicken-and-egg deadlock.
  --     Its user_id is a foreign key from phase 1, not phase 2 tenancy.
  --
  -- users and strength_exercises are absent from this list because they have no
  -- user_id column at all, so the query below never finds them. users is
  -- identity; strength_exercises is a shared movement catalogue that every
  -- athlete sees by design.
  excluded text[] := ARRAY[
    'user_identities'
  ];
  covered int := 0;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND a.attname = 'user_id'
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND NOT (c.relname = ANY(excluded))
    ORDER BY c.relname
  LOOP
    -- ENABLE alone would be a no-op: Postgres exempts a table's owner from its
    -- own policies and the app connects as the owning role. FORCE removes that
    -- exemption and is what actually applies the policy to the app's
    -- connection. See the long note in 0053_rls.sql.
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);

    -- A default on user_id is indistinguishable from correct behaviour right up
    -- until it is catastrophic: an insert that forgets user_id attributes a
    -- second athlete's data to whoever the default names, silently. Without it
    -- the same mistake is a not-null violation at the first write.
    EXECUTE format('ALTER TABLE %I ALTER COLUMN user_id DROP DEFAULT', t);

    -- Recreated rather than skipped-if-present, so editing the predicate here
    -- and re-running actually updates the policy. A policy left at an older
    -- definition because it "already existed" is the silent drift this phase
    -- exists to end.
    --
    -- Both defensive pieces of the predicate are load-bearing. The second
    -- argument to current_setting (missing_ok) makes an unset setting return
    -- NULL instead of raising, so a query with no context matches no rows
    -- rather than erroring. NULLIF maps the empty string, which is what a
    -- setting reset within a transaction reads back as, to NULL as well, since
    -- ''::uuid would raise. No context set means no rows: the failure is an
    -- empty screen, never someone else's data.
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL'
      ' USING (user_id = NULLIF(current_setting(''app.user_id'', true), '''')::uuid)'
      ' WITH CHECK (user_id = NULLIF(current_setting(''app.user_id'', true), '''')::uuid)',
      t || '_tenant_isolation', t
    );

    covered := covered + 1;
  END LOOP;

  -- Loud, because the alternative is a migration that silently covers nothing.
  -- If the query above ever stops matching (a schema rename, a permissions
  -- change) this is the only thing that would say so.
  IF covered = 0 THEN
    RAISE EXCEPTION
      'RLS coverage migration matched no tenanted tables. Expected at least one table with a user_id column in the public schema. Refusing to report success.';
  END IF;

  RAISE NOTICE 'RLS enforced on % tenanted tables', covered;
END $$;

-- Phase 3 of the multi-user plan: enforcement.
--
-- Phase 2 gave every row an owner. This turns that column into a rule the
-- database enforces, so that a query which forgets to filter by user returns
-- nothing instead of returning everyone. Filtering in application code fails
-- open; row level security fails closed. That is the whole reason this file
-- exists rather than 62 hand-written WHERE clauses.
--
-- The per-request context is set by withUser() in src/db/with-user.ts, which
-- issues set_config('app.user_id', <id>, true) inside an explicit transaction.
-- Read the comment at the top of that file before changing anything here; the
-- two halves only work together.
--
--
-- ── FORCE, not just ENABLE. Do not "simplify" this away. ─────────────────────
--
-- ALTER TABLE ... ENABLE ROW LEVEL SECURITY on its own would do NOTHING here.
-- Postgres exempts a table's owner from that table's policies. Kadenz connects
-- to Neon as the role that owns every one of these tables, so with ENABLE
-- alone the app would keep reading every user's rows exactly as it does today
-- while pg_tables.rowsecurity reported true. A green check over a total leak.
--
-- FORCE ROW LEVEL SECURITY removes the owner exemption, which is what actually
-- applies the policies to the app's own connection.
--
-- e2e/specs/rls-coverage.spec.ts asserts on pg_class.relforcerowsecurity, NOT
-- pg_tables.rowsecurity, for exactly this reason: the weaker column is true in
-- both the safe and the unsafe case, so asserting on it would prove nothing. It
-- runs against the e2e Postgres because this is a claim about a live database,
-- not about the schema, and cannot be checked without one.
--
-- The other way to get policies applied is to connect as a role that does not
-- own the tables. That was rejected: it needs a new role provisioned and
-- DATABASE_URL swapped in Vercel, and if either is missed the app silently
-- keeps running as the owner with RLS not applied. That fails open. FORCE
-- needs no infrastructure change and cannot be half-applied.
--
--
-- ── The predicate, and why it fails closed ───────────────────────────────────
--
--   user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
--
-- Both defensive pieces are load-bearing:
--
--   * current_setting(..., true) -- the second argument, missing_ok, makes an
--     unset setting return NULL instead of raising. Without it, any query on a
--     connection with no context raises an error. With it, the comparison is
--     NULL, which is not true, so no rows match. Nothing is visible until a
--     context is deliberately set.
--
--   * NULLIF(..., '') -- a setting that was set and then reset within a
--     transaction reads back as the empty string, not NULL, and ''::uuid
--     raises "invalid input syntax for type uuid". Mapping '' to NULL first
--     keeps the no-context case quiet and closed rather than erroring.
--
-- So: no context set => no rows. That is the desired failure. An RLS mistake
-- shows up as an empty screen, never as someone else's data.
--
--
-- ── WITH CHECK, and why the Phase 2 defaults must go ─────────────────────────
--
-- Each policy is FOR ALL with both USING and WITH CHECK. USING governs which
-- rows can be seen, updated or deleted. WITH CHECK governs the rows an INSERT
-- or UPDATE may leave behind, so a request cannot write a row belonging to
-- somebody else.
--
-- Phase 2 gave every user_id column a DEFAULT of the owner's id, deliberately,
-- as a scaffold so that inserts kept working before this phase existed. That
-- default is actively dangerous now: an insert that forgets user_id would
-- silently attribute a second user's data to the owner. It is dropped below.
-- With the default gone and the column NOT NULL, a forgotten user_id is a
-- not-null violation -- loud, immediate, and impossible to ship unnoticed.
--
-- e2e/specs/rls-coverage.spec.ts asserts no tenanted column carries a default,
-- so re-adding one to make an insert compile fails the build.
--
--
-- ── Note for whoever writes the next data migration ──────────────────────────
--
-- FORCE applies to the migration runner too, because it connects as the same
-- owning role. A future migration that needs to touch rows across all users
-- (a backfill, a repair) will match zero rows, silently, because no context is
-- set. Wrap that statement:
--
--   ALTER TABLE "x" NO FORCE ROW LEVEL SECURITY;
--   UPDATE "x" SET ...;
--   ALTER TABLE "x" FORCE ROW LEVEL SECURITY;
--
-- Deliberate and visible in the diff, which is the point. Do not leave the
-- table in NO FORCE; the coverage test will fail if you do.

-- ── The tenanted tables ──────────────────────────────────────────────────────
--
-- A loop over one list rather than 18 copy-pasted blocks, so that "every
-- tenanted table" is a single reviewable array instead of something a reader
-- has to verify by counting. This list is checked against reality by the
-- coverage test, which derives its own list from information_schema by looking
-- for a user_id column, so a table added later and forgotten here fails.
DO $$
DECLARE
  t text;
  tenanted text[] := ARRAY[
    'profiles',
    'plans',
    'weeks',
    'workouts',
    'blocks',
    'activities',
    'deleted_activities',
    'activity_trash',
    'personal_records',
    'sync_outbox',
    'strength_sessions',
    'wellness_logs',
    'wellness_metrics',
    'strength_plan_settings',
    'custom_workout_templates',
    'push_subscriptions',
    'reminder_settings',
    'sent_reminders'
  ];
BEGIN
  FOREACH t IN ARRAY tenanted LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);

    -- Drop the Phase 2 scaffold default. Idempotent: dropping an absent
    -- default is a no-op, not an error.
    EXECUTE format('ALTER TABLE %I ALTER COLUMN user_id DROP DEFAULT', t);

    -- Recreated rather than skipped-if-present, so that editing the predicate
    -- in this file and re-running actually updates the policy. A policy left
    -- at an older definition because it "already existed" is precisely the
    -- kind of silent drift this phase is meant to end.
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL'
      ' USING (user_id = NULLIF(current_setting(''app.user_id'', true), '''')::uuid)'
      ' WITH CHECK (user_id = NULLIF(current_setting(''app.user_id'', true), '''')::uuid)',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;
--> statement-breakpoint

-- ── The child tables ─────────────────────────────────────────────────────────
--
-- strength_sets, pain_logs and custom_workout_slots carry no user_id. Phase 2
-- left them alone on the grounds that each is reachable only through an
-- already-tenanted parent, and that tenancy on the parent is therefore enough.
--
-- For RLS that reasoning does not hold. A policy on strength_sessions does not
-- filter a query that selects FROM strength_sets directly, and several routes
-- do exactly that: /api/export/strength-sets and
-- /api/strength/history/[exerciseId] both read the sets table on its own.
-- Without a policy here those routes would return every user's training log.
--
-- Enforced by joining to the parent rather than by denormalising a user_id
-- column onto the child. The parent's own policy is not what does the work --
-- policies do not nest -- the EXISTS predicate below repeats the same context
-- comparison against the parent row. The join is indexed (session_id and
-- template_id both have indexes) and these tables are read per session, so the
-- cost is a single index lookup.
--
-- Denormalising was the alternative and was rejected: it would put the same
-- fact in two places, which is the bug shape this codebase already produces
-- most often, and a child row whose user_id drifted from its parent's would be
-- invisible to one and visible to the other.
ALTER TABLE "strength_sets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "strength_sets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "strength_sets_tenant_isolation" ON "strength_sets";
--> statement-breakpoint
CREATE POLICY "strength_sets_tenant_isolation" ON "strength_sets" FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "strength_sessions" s
    WHERE s."id" = "strength_sets"."session_id"
      AND s."user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "strength_sessions" s
    WHERE s."id" = "strength_sets"."session_id"
      AND s."user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
  ));
--> statement-breakpoint

ALTER TABLE "pain_logs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "pain_logs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "pain_logs_tenant_isolation" ON "pain_logs";
--> statement-breakpoint
CREATE POLICY "pain_logs_tenant_isolation" ON "pain_logs" FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "strength_sessions" s
    WHERE s."id" = "pain_logs"."session_id"
      AND s."user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "strength_sessions" s
    WHERE s."id" = "pain_logs"."session_id"
      AND s."user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
  ));
--> statement-breakpoint

ALTER TABLE "custom_workout_slots" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "custom_workout_slots" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "custom_workout_slots_tenant_isolation" ON "custom_workout_slots";
--> statement-breakpoint
CREATE POLICY "custom_workout_slots_tenant_isolation" ON "custom_workout_slots" FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "custom_workout_templates" ct
    WHERE ct."id" = "custom_workout_slots"."template_id"
      AND ct."user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "custom_workout_templates" ct
    WHERE ct."id" = "custom_workout_slots"."template_id"
      AND ct."user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
  ));
--> statement-breakpoint

-- ── Left without policies, on purpose ────────────────────────────────────────
--
-- users and user_identities are identity, not anyone's training data. withUser
-- and the OAuth callback both have to read them before a context exists, so a
-- policy here would be a chicken-and-egg deadlock. They hold no training data
-- and are never returned to a client.
--
-- strength_exercises is a shared catalogue of movements. Every user sees the
-- same rows by design; there is nothing to isolate.
--
-- The coverage test knows about these three by name. Adding a fourth exception
-- means editing that list, which is a conscious act with a reviewer attached.
SELECT 1;

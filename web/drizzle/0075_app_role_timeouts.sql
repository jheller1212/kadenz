-- ── Nothing the app runs may wait forever ───────────────────────────────────
--
-- kadenz_app had no statement_timeout, no lock_timeout and no
-- idle_in_transaction_session_timeout — `pg_roles.rolconfig` was null. Every
-- other role on the instance had them: PostgREST's `authenticator` carries 8s
-- statement and lock timeouts. The role the entire application runs as had
-- none at all.
--
-- What that cost, concretely: /api/cron/reminders and /api/cron/sync-drain
-- both ran past 180s and were killed by their caller, on a schedule, for
-- weeks. Both routes carry a 120s wall-clock budget and both were bounded
-- per user (#174, #180) — but a budget only bounds the loop it wraps. A query
-- that blocks BEFORE the loop, or while waiting on a lock, is not something
-- application code can time out; it sits there until something at the
-- database level says stop, and nothing did.
--
-- The failure mode is worse than the failed run. A function killed mid-query
-- never releases its transaction, so the connection is left
-- idle-in-transaction; with `max: 1` connection per instance the next request
-- on that warm instance blocks on it, and that is how a cron once returned a
-- 500 from the Google Calendar reconnect page (#178).
--
-- ── The numbers, and why these ones ─────────────────────────────────────────
--
-- statement_timeout 30s — an order of magnitude above any legitimate single
--   statement here (the heaviest is a plan generation's bulk insert, well
--   under a second for ~700 rows) and comfortably below the 120s cron budget,
--   so a query that hits it fails inside the budget rather than outliving it.
--
-- lock_timeout 10s — waiting longer than this means real contention, and on a
--   single-connection client the useful response to contention is to fail and
--   let the next tick retry, not to queue.
--
-- idle_in_transaction_session_timeout 60s — the direct fix for the wedged
--   connection above: a transaction abandoned by a killed invocation is
--   reaped instead of poisoning the next request that lands on the instance.
--
-- Set on the ROLE rather than per connection so it applies to every session
-- regardless of which client opened it — the app, a migration run, a psql
-- session someone opens to poke at production.

-- Guarded: kadenz_app is the production role and does not exist in the
-- embedded Postgres the e2e suite applies these migrations to. An unguarded
-- ALTER ROLE would abort the whole migration there, turning a reliability fix
-- into a broken test suite.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadenz_app') THEN
    EXECUTE $cmd$ALTER ROLE kadenz_app SET statement_timeout = '30s'$cmd$;
    EXECUTE $cmd$ALTER ROLE kadenz_app SET lock_timeout = '10s'$cmd$;
    EXECUTE $cmd$ALTER ROLE kadenz_app SET idle_in_transaction_session_timeout = '60s'$cmd$;
  END IF;
END $$;

#!/usr/bin/env bash
# Restores a Neon data-only dump (see dump-neon.sh) onto a Supabase database
# whose schema was already built by the full drizzle/ migration chain
# (verify-fresh-chain.mjs). Run that first. This script refuses to guess
# whether it was.
#
# ── FORCE ROW LEVEL SECURITY has to come off for this, deliberately ─────────
#
# Every tenanted table is FORCE ROW LEVEL SECURITY once 0053/0068 have run,
# which applies policies to the table owner too — including this restore,
# which connects as the owner and sets no app.user_id. Every row would be
# rejected by WITH CHECK. This is not a bug to work around quietly: 0053's own
# header comment names this exact situation and says how to handle it —
# NO FORCE, do the write, FORCE again — so that is what this script does,
# per table, and never leaves a table in NO FORCE.
#
# ── No --disable-triggers ────────────────────────────────────────────────────
#
# pg_restore's --disable-triggers requires superuser, and the whole point of
# this migration is that the app's role on Supabase is deliberately NOT
# superuser (see verify-rls.mjs check #1 — a superuser bypasses RLS and would
# make FORCE meaningless). So this restore relies on pg_dump's normal
# dependency-ordered data section instead: --data-only already emits tables in
# an order that satisfies foreign keys as long as the restore runs
# single-threaded (no -j), which is what this script does.
#
# ── The users row 0051 seeds has to get out of the way first ────────────────
#
# 0051_users.sql inserts the fixed owner row (id
# 00000000-0000-0000-0000-000000000001) so later migrations have a user to
# backfill onto. The real Neon dump contains that exact row (same id — it is
# the same production owner). A plain data restore would hit a primary key
# conflict on the first statement. The migration-built schema is otherwise
# completely empty at this point, so truncating users first (cascading, since
# nothing else has rows yet to cascade into) is the whole fix, not a shortcut.
#
# Usage:
#   SUPABASE_DATABASE_URL=postgres://...supabase.co:5432/postgres \
#     ./scripts/supabase-migration/restore-supabase.sh neon-data.dump
#
# Use the DIRECT connection (port 5432, not the 6543 pooler) for this. See
# docs/supabase-cutover.md for why — pg_restore needs a stable, long-lived,
# non-transaction-pooled connection, and this is a bulk administrative
# operation, not app traffic.

set -euo pipefail

if [ -z "${SUPABASE_DATABASE_URL:-}" ]; then
  echo "SUPABASE_DATABASE_URL must be set, pointed at the DIRECT connection (port 5432)." >&2
  exit 1
fi

DUMP_FILE="${1:-neon-data.dump}"
if [ ! -f "$DUMP_FILE" ]; then
  echo "Dump file $DUMP_FILE not found. Run dump-neon.sh first." >&2
  exit 1
fi

echo "Confirming the target schema was built by the migration chain…"
TABLE_COUNT=$(psql "$SUPABASE_DATABASE_URL" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")
if [ "$TABLE_COUNT" -lt 40 ]; then
  echo "Only $TABLE_COUNT tables found in public schema — this does not look like a" >&2
  echo "database the full migration chain has run against. Run" >&2
  echo "verify-fresh-chain.mjs first. Refusing to restore into a wrong or partial schema." >&2
  exit 1
fi
echo "  $TABLE_COUNT tables present, looks migrated. Proceeding."

echo "Suspending FORCE ROW LEVEL SECURITY on every tenanted table for the restore…"
psql "$SUPABASE_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  t text;
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
      AND c.relname <> 'user_identities'
    UNION
    SELECT unnest(ARRAY['strength_sets', 'pain_logs', 'custom_workout_slots'])
  LOOP
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
SQL

echo "Clearing the 0051 seed row from users so the real row can be restored…"
psql "$SUPABASE_DATABASE_URL" -v ON_ERROR_STOP=1 -c "TRUNCATE TABLE users CASCADE;"

echo "Restoring data from $DUMP_FILE (single-threaded, dependency-ordered)…"
pg_restore \
  --data-only \
  --no-owner \
  --no-privileges \
  --single-transaction \
  --dbname="$SUPABASE_DATABASE_URL" \
  "$DUMP_FILE"

echo "Re-enabling FORCE ROW LEVEL SECURITY on every tenanted table…"
psql "$SUPABASE_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  t text;
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
      AND c.relname <> 'user_identities'
    UNION
    SELECT unnest(ARRAY['strength_sets', 'pain_logs', 'custom_workout_slots'])
  LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
SQL

echo "Restore complete. Now run:"
echo "  NEON_DATABASE_URL=... SUPABASE_DATABASE_URL=... node scripts/supabase-migration/verify-row-counts.mjs"
echo "before trusting this restore for anything."

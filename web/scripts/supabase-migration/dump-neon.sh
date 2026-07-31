#!/usr/bin/env bash
# Dumps DATA ONLY from Neon, in a form that can be restored onto a database
# whose schema was built by the drizzle/ migration chain rather than by
# `pg_restore`'s own schema section.
#
# ── Why data-only, restored onto our own migration-built schema ─────────────
#
# The alternative is `pg_dump` with schema+data together and `pg_restore`
# straight onto an empty Supabase database. That was rejected:
#
#   - It bypasses the migration chain entirely, so verify-fresh-chain.mjs
#     proves nothing about what actually ends up on Supabase. The one thing
#     this whole task exists to de-risk (a partial or drifted migration
#     chain) would go unchecked on the one database that matters.
#   - Neon's pg_dump schema section includes Neon-specific role grants and
#     ownership that do not exist on Supabase and would need editing anyway.
#   - RLS (FORCE, policies) lives in 0053/0068 as hand-written SQL, not in
#     anything pg_dump's schema section would reconstruct from Neon, because
#     Neon was never running these policies for real — RLS is being ADOPTED
#     as part of this move, this script's target already applied it.
#
# So the order is: migration chain builds the schema (including RLS) on
# Supabase FIRST, then this dump is restored into the tables that already
# exist, with RLS temporarily suspended so the restore isn't fighting policies
# meant for an app connection, not a bulk load.
#
# Usage:
#   NEON_DATABASE_URL=postgres://...neon.tech/... ./scripts/supabase-migration/dump-neon.sh
#
# Produces ./neon-data.dump (custom format, pg_restore-compatible, data only).
# This file contains real user training data. Do not commit it. Delete it
# once the restore is verified.

set -euo pipefail

if [ -z "${NEON_DATABASE_URL:-}" ]; then
  echo "NEON_DATABASE_URL must be set (read-only use — this script only dumps)." >&2
  exit 1
fi

OUT="${1:-neon-data.dump}"

echo "Dumping DATA ONLY from Neon to $OUT ..."
pg_dump "$NEON_DATABASE_URL" \
  --data-only \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$OUT"

echo "Done. $(du -h "$OUT" | cut -f1) written."
echo "This file is real user data — keep it out of git, delete after the restore is verified."

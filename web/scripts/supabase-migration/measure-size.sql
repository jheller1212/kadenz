-- Run this against Neon (read-only) to get the real number for the Supabase
-- free-tier 500 MB cap, instead of the estimate in docs/supabase-cutover.md.
--
--   psql "$NEON_DATABASE_URL" -f scripts/supabase-migration/measure-size.sql
--
-- Ordered largest-first. activities is expected to dominate because of
-- streams_json, splits_json, laps_json and polyline — see the note in
-- docs/supabase-cutover.md on why those are unbounded per row.

SELECT
  relname AS table_name,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
  pg_size_pretty(pg_relation_size(relid)) AS table_size,
  pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid)) AS index_and_toast_size,
  (SELECT count(*) FROM pg_class c WHERE c.oid = relid) AS exists_check,
  n_live_tup AS approx_row_count
FROM pg_catalog.pg_statio_user_tables
JOIN pg_stat_user_tables USING (relid, schemaname, relname)
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(relid) DESC;

-- Whole-database total, for the headline number against the 500 MB cap:
SELECT pg_size_pretty(pg_database_size(current_database())) AS database_total_size;

-- The specific unbounded columns on activities, broken out, since they are
-- the columns most likely to blow the free tier as training history grows:
SELECT
  pg_size_pretty(sum(pg_column_size(streams_json))) AS streams_json_total,
  pg_size_pretty(sum(pg_column_size(splits_json))) AS splits_json_total,
  pg_size_pretty(sum(pg_column_size(laps_json))) AS laps_json_total,
  pg_size_pretty(sum(pg_column_size(polyline))) AS polyline_total,
  count(*) AS activity_rows,
  count(streams_json) AS rows_with_streams_json
FROM activities;

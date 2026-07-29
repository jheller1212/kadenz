-- Real start/end timestamps for a strength session, derived from logged sets
-- rather than the moment "Start"/"Finish" is tapped: opening a session and
-- reading through it must not start the clock, and logging a final set then
-- leaving the app open must not inflate the session's duration. Maintained by
-- the sets route (started_at set once, ended_at bumped on every logged set)
-- and read by the auto-close sweep (see lib/strength/reconcile.ts) and the
-- sessions PATCH route when a session is marked completed.
ALTER TABLE "strength_sessions" ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone;
ALTER TABLE "strength_sessions" ADD COLUMN IF NOT EXISTS "ended_at" timestamp with time zone;

-- Backfill from existing logged sets only — a session with no sets gets no
-- guessed timestamp (never overwrite with a guess). first/last set createdAt
-- is the same signal the app will use going forward, so history built before
-- this migration lines up with history built after it.
UPDATE "strength_sessions" s
SET "started_at" = sub.first_set_at,
    "ended_at" = sub.last_set_at
FROM (
  SELECT session_id, min(created_at) AS first_set_at, max(created_at) AS last_set_at
  FROM "strength_sets"
  GROUP BY session_id
) sub
WHERE s.id = sub.session_id
  AND s.started_at IS NULL
  AND s.ended_at IS NULL;

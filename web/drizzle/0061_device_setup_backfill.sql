-- Do not ask an athlete to set up devices they are already using.
--
-- 0060 leaves device_setup_at NULL for everyone, which means "never asked",
-- which means prompt. For a brand new athlete that is right. For an athlete
-- whose watch has been feeding this database for months it is nonsense: the
-- first thing they would see after the upgrade is a step offering to connect
-- Garmin, with Garmin already connected.
--
-- So mark the athletes whose data already proves a working connection, and
-- record what that connection is. The evidence is the data itself rather than
-- a token, deliberately: Strava and Garmin credentials are installation-level
-- env vars today (per-user Strava tokens are a separate workstream), so there
-- is no per-user token row to read. Rows that arrived are the one per-user
-- signal that exists, and a row that arrived is proof the connection worked.
--
--   garmin  <- any wellness_metrics night attributed to the user. Only the
--              Garmin worker writes that table today, and it is also the only
--              source that can ever satisfy the recovery baseline, so getting
--              this one right is what keeps the warm-up copy honest.
--   strava  <- any activity imported with provider 'strava'.
--
-- Google Calendar is not inferred. It is a push target with no inbound rows,
-- and guessing it wrong would either hide a connection the athlete wants or
-- claim one they never made.
--
-- Idempotent through the NULL guard, and it never touches an athlete who has
-- already answered for themselves. An athlete with no matching rows keeps
-- device_setup_at NULL and gets asked, which is exactly right: no data has
-- ever arrived for them, so there is nothing to assume.

UPDATE "users" u
SET
  "device_connections" = evidence.connections,
  "device_setup_at" = now(),
  "updated_at" = now()
FROM (
  SELECT
    u2."id" AS user_id,
    (
      CASE WHEN EXISTS (
        SELECT 1 FROM "wellness_metrics" wm
        WHERE wm."user_id" = u2."id" AND wm."source" = 'garmin'
      ) THEN '["garmin"]'::jsonb ELSE '[]'::jsonb END
      ||
      CASE WHEN EXISTS (
        SELECT 1 FROM "activities" a
        WHERE a."user_id" = u2."id" AND a."provider" = 'strava'
      ) THEN '["strava"]'::jsonb ELSE '[]'::jsonb END
    ) AS connections
  FROM "users" u2
  WHERE u2."device_setup_at" IS NULL
) AS evidence
WHERE u."id" = evidence.user_id
  AND u."device_setup_at" IS NULL
  AND jsonb_array_length(evidence.connections) > 0;

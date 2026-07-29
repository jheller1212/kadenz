-- Phase 3, second half: make uniqueness mean "unique to this user".
--
-- Row level security decides what a user can READ. It has no effect on a
-- unique index, which is enforced across every row in the table no matter who
-- is asking. So the isolation work is only half done without this file, and
-- the half that is missing fails in a nastier way than a leak.
--
-- Concretely, with the indexes as Phase 2 left them:
--
--   * Two users cannot both have a wellness row for the same source and date.
--     Every user pulling from Garmin writes (source='garmin', date=today), so
--     the second user's daily pull fails outright. This is not a rare
--     collision, it is every user every day.
--
--   * Two users cannot both have a check-in for the same calendar day.
--
--   * Two users cannot both import an activity carrying the same external id.
--
-- Worse than the error itself is what an upsert does. The insert paths use
-- ON CONFLICT ... DO UPDATE, and the conflicting row belongs to somebody else.
-- The conflict is detected against a row the caller cannot see, and the UPDATE
-- it turns into is refused by that table's WITH CHECK. The user is left with a
-- write that cannot succeed and an error that names an index, pointing nowhere
-- near the actual cause. Scoping the index to the user removes the collision
-- rather than reporting it more clearly.
--
-- Every index below gains user_id as its leading column, which also keeps it
-- useful for the per-user lookups the app actually issues.

-- ── activities: provider / external id ───────────────────────────────────────
--
-- The WHERE clause is carried over verbatim from 0050. It matters: manually
-- created activities have neither column set, and a partial index is the only
-- way to let many such rows coexist. It also has to be repeated by any
-- ON CONFLICT that targets this index -- Postgres only matches a partial index
-- if the statement restates its predicate -- and that requirement is unchanged
-- by the extra column.
DROP INDEX IF EXISTS "activities_provider_external_id_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "activities_user_provider_external_id_uq"
  ON "activities" ("user_id", "provider", "external_id")
  WHERE "provider" IS NOT NULL AND "external_id" IS NOT NULL;
--> statement-breakpoint

-- ── activities: the legacy per-source id columns ─────────────────────────────
--
-- strava_id and garmin_id are the pre-provider way of saying the same thing.
-- They are still written on every path, so their global UNIQUE constraints
-- would collide for exactly the same reason as the index above, and fixing
-- only the new column would leave the old one to fail the import instead.
--
-- Dropped as constraints and recreated as user-scoped indexes. Drizzle
-- generated these from .unique() in schema.ts, so the names are its
-- convention; IF EXISTS covers a database where they were never created under
-- that name.
ALTER TABLE "activities" DROP CONSTRAINT IF EXISTS "activities_strava_id_unique";
--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT IF EXISTS "activities_garmin_id_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "activities_user_strava_id_uq"
  ON "activities" ("user_id", "strava_id")
  WHERE "strava_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "activities_user_garmin_id_uq"
  ON "activities" ("user_id", "garmin_id")
  WHERE "garmin_id" IS NOT NULL;
--> statement-breakpoint

-- ── wellness_metrics ─────────────────────────────────────────────────────────
--
-- The one that breaks first and hardest: (source, date) means one Garmin
-- reading per day for the whole installation. 0049 created it to let a second
-- SOURCE coexist for one athlete; it now has to let a second ATHLETE coexist
-- too.
DROP INDEX IF EXISTS "wellness_metrics_source_date_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wellness_metrics_user_source_date_uq"
  ON "wellness_metrics" ("user_id", "source", "date");
--> statement-breakpoint

-- ── wellness_logs ────────────────────────────────────────────────────────────
--
-- Same shape, with the COALESCE expression carried over from 0005 unchanged.
-- The zero uuid stands in for "no household profile, this is the account
-- owner's own check-in", because NULL never collides with NULL in a unique
-- index and without the COALESCE the constraint would not apply to the rows
-- that need it most.
DROP INDEX IF EXISTS "wellness_logs_date_profile_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wellness_logs_user_date_profile_uq"
  ON "wellness_logs" (
    "user_id",
    "date",
    COALESCE("profile_id", '00000000-0000-0000-0000-000000000000'::uuid)
  );
--> statement-breakpoint

-- ── push_subscriptions ───────────────────────────────────────────────────────
--
-- A push endpoint is issued per browser install, so two people on separate
-- devices never collide. One shared device does: a household tablet where both
-- users have signed in produces one endpoint and two subscriptions, and under
-- the global constraint the second person to enable reminders silently steals
-- the first person's row. Scoping to the user lets both exist, which is what
-- the endpoint being "unique per install" was always meant to express.
ALTER TABLE "push_subscriptions" DROP CONSTRAINT IF EXISTS "push_subscriptions_endpoint_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_user_endpoint_uq"
  ON "push_subscriptions" ("user_id", "endpoint");
--> statement-breakpoint

-- ── Deliberately left global ─────────────────────────────────────────────────
--
-- strength_sets (session_id, exercise_id, set_number) and sent_reminders
-- (workout_id) are already keyed by a uuid belonging to exactly one user, so
-- they cannot collide across users. strength_exercises.slug is the shared
-- movement catalogue and is meant to be global.
--
-- sync_outbox.idempotency_key is left global and is NOT safe, but the fix is
-- not an index change. See the PR body: saveTokens() writes one row under a
-- fixed key, so a second user connecting Strava overwrites the first user's
-- tokens. Per-user credentials are Phase 4; widening this index would make
-- that row look tenanted while the code still treats it as a singleton, which
-- is worse than leaving the collision visible.
SELECT 1;

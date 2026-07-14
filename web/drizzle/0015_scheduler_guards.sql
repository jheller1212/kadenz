-- Race-proof the scheduler: dedupe then enforce uniqueness at the DB level.
-- One settings row per profile (owner = NULL profile_id).
DELETE FROM "strength_plan_settings" a
USING "strength_plan_settings" b
WHERE COALESCE(a."profile_id", '00000000-0000-0000-0000-000000000000'::uuid)
    = COALESCE(b."profile_id", '00000000-0000-0000-0000-000000000000'::uuid)
  AND a."created_at" < b."created_at";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "strength_plan_settings_profile_unique"
  ON "strength_plan_settings" (COALESCE("profile_id", '00000000-0000-0000-0000-000000000000'::uuid));
--> statement-breakpoint
-- One auto-scheduled planned session per exact slot timestamp per profile
-- (auto sessions all use noon-UTC timestamps, so equality = same day).
DELETE FROM "strength_sessions" a
USING "strength_sessions" b
WHERE a."auto_scheduled" AND b."auto_scheduled"
  AND a."status" = 'planned' AND b."status" = 'planned'
  AND a."date" = b."date"
  AND COALESCE(a."profile_id", '00000000-0000-0000-0000-000000000000'::uuid)
    = COALESCE(b."profile_id", '00000000-0000-0000-0000-000000000000'::uuid)
  AND a."created_at" > b."created_at";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "strength_sessions_auto_slot_unique"
  ON "strength_sessions" (COALESCE("profile_id", '00000000-0000-0000-0000-000000000000'::uuid), "date")
  WHERE "auto_scheduled" = true AND "status" = 'planned';

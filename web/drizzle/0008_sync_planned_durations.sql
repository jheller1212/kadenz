-- Planned stock sessions created before the coach-feedback templates still
-- carry the old target durations (lower 28, lower_achilles 46), so the picker
-- (~35 / ~50) disagreed with the session once opened. Sync planned sessions to
-- the current template values. Completed/skipped sessions keep their history;
-- custom sessions are type full_body with their own estimate and match already.
UPDATE "strength_sessions"
SET "target_duration_minutes" = 35
WHERE "type" = 'lower' AND "status" = 'planned' AND "target_duration_minutes" IS DISTINCT FROM 35;
--> statement-breakpoint
UPDATE "strength_sessions"
SET "target_duration_minutes" = 50
WHERE "type" = 'lower_achilles' AND "status" = 'planned' AND "target_duration_minutes" IS DISTINCT FROM 50;

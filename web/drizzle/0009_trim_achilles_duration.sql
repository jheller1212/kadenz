-- Standalone Achilles trimmed to the focused tendon work (explosive + 2 HSR
-- lifts + toe walks, glute bridge dropped): 25 → 20 min. Sync planned sessions.
UPDATE "strength_sessions"
SET "target_duration_minutes" = 20
WHERE "type" = 'achilles' AND "status" = 'planned' AND "target_duration_minutes" IS DISTINCT FROM 20;

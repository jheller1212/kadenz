-- Upper day restored to the original 5 lifts (renegade row back in) plus a new
-- lateral raise: 35 → 40 min. Seed the new exercise (every EXERCISES entry
-- needs a catalogue row or set logging 422s) and sync planned sessions.
INSERT INTO "strength_exercises" ("slug", "name", "category", "tempo_note", "default_sets", "rep_low", "rep_high", "start_weight_kg", "sort_order")
VALUES
	('lateral_raise', 'Lateral raise', 'upper', 'Strict, no swing — light weight, controlled lower', 3, 12, 15, 5, 24)
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
UPDATE "strength_sessions"
SET "target_duration_minutes" = 40
WHERE "type" = 'upper' AND "status" = 'planned' AND "target_duration_minutes" IS DISTINCT FROM 40;

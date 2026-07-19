DELETE FROM "strength_sets" a USING "strength_sets" b
WHERE a.session_id = b.session_id
  AND a.exercise_id = b.exercise_id
  AND a.set_number = b.set_number
  AND (a.created_at < b.created_at OR (a.created_at = b.created_at AND a.ctid < b.ctid));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "strength_sets_session_exercise_set_uq"
  ON "strength_sets" ("session_id", "exercise_id", "set_number");

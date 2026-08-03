-- Dumbbell-and-bench movements the catalogue was missing.
--
-- Every code-side EXERCISES entry needs a catalogue row or set logging 422s
-- silently (same reason 0013 exists). seedStrengthExercises only runs from
-- `npm run seed:strength`, never on deploy, so adding entries to program.ts
-- alone would leave them invisible in production.
--
-- Why these six: a bench previously unlocked exactly ONE exercise for a
-- dumbbell owner (dumbbell_bench_press). The catalogue's other three bench
-- movements all additionally require a barbell, so ticking "Bench" took an
-- athlete from 44 available exercises to 45. bench_dip and decline_push_up
-- need only the bench, so they also land for anyone without dumbbells.
--
-- sort_order continues from 87, the current maximum, and matches the append
-- position in EXERCISES so the seeder and this migration agree.
--
-- This table is the shared movement catalogue and is deliberately global, not
-- tenanted (see 0054's closing note), so it creates nothing that
-- 0068_rls_covers_every_tenanted_table needs to have covered.
INSERT INTO "strength_exercises" ("slug", "name", "category", "equipment_note", "tempo_note", "default_sets", "rep_low", "rep_high", "start_weight_kg", "sort_order")
VALUES
	('incline_db_press', 'Incline dumbbell press', 'upper', 'Bench set to roughly 30 degrees — steeper turns it into a shoulder press', 'Lower under control until the elbows are level with the torso', 3, 8, 12, 10, 88),
	('bench_supported_row', 'Bench-supported row', 'upper', 'One knee and one hand on the bench, opposite arm rowing', 'Pull to the hip, not the armpit — no torso twist', 3, 8, 12, 12.5, 89),
	('db_bulgarian_split_squat', 'Bulgarian split squat', 'lower', 'Rear foot on the bench, dumbbells at your sides', 'Weight through the front heel, torso tall', 3, 8, 12, 10, 90),
	('db_hip_thrust', 'Dumbbell hip thrust', 'lower', 'Shoulder blades on the bench, dumbbell across the hips', 'Drive the hips to level, 1 s squeeze, ribs down', 3, 10, 15, 15, 91),
	('bench_dip', 'Bench dip', 'upper', 'Hands on the bench edge, heels on the floor', 'Elbows straight back, stop if the shoulders complain', 3, 8, 15, NULL, 92),
	('decline_push_up', 'Decline push-up', 'upper', 'Feet on the bench — harder than a floor push-up, and biased to the upper chest', 'Body in one line, chest to just above the floor', 3, 8, 15, NULL, 93)
ON CONFLICT ("slug") DO NOTHING;

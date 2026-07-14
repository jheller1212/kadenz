-- Extended exercise library for the custom-workout builder (home setup:
-- dumbbells + chair + floor). Every code-side EXERCISES entry needs a
-- catalogue row or set logging 422s silently.
INSERT INTO "strength_exercises" ("slug", "name", "category", "equipment_note", "tempo_note", "default_sets", "rep_low", "rep_high", "start_weight_kg", "sort_order")
VALUES
	('db_floor_fly', 'Floor chest fly', 'upper', 'Lying on the floor, slight elbow bend', 'Slow arc, stop when upper arms touch the floor', 3, 10, 15, 7.5, 30),
	('push_up', 'Push-up', 'upper', NULL, 'Body in one line, chest to just above the floor', 3, 8, 20, NULL, 31),
	('bicep_curl', 'Biceps curl', 'upper', NULL, 'No swing — elbows pinned to your sides', 3, 10, 15, 10, 32),
	('hammer_curl', 'Hammer curl', 'upper', NULL, 'Neutral grip, controlled lower', 3, 10, 15, 10, 33),
	('overhead_triceps_extension', 'Overhead triceps extension', 'upper', 'Both hands on one dumbbell behind the head', 'Elbows stay narrow and pointed forward', 3, 10, 15, 10, 34),
	('triceps_kickback', 'Triceps kickback', 'upper', 'Hinge forward, support on a chair if needed', 'Upper arm parallel to the floor, squeeze at lockout', 3, 10, 15, 5, 35),
	('front_raise', 'Front raise', 'upper', NULL, 'To eye height, no momentum', 3, 10, 15, 5, 36),
	('rear_delt_fly', 'Rear-delt fly', 'upper', 'Hinge forward, flat back', 'Lead with the elbows, pause at the top', 3, 12, 15, 5, 37),
	('arnold_press', 'Arnold press', 'upper', NULL, 'Rotate palms out on the way up, controlled return', 3, 8, 12, 7.5, 38),
	('db_pullover', 'Dumbbell pullover', 'upper', 'Lying on the floor, both hands on one dumbbell', 'Slow arc overhead, ribs down', 3, 10, 15, 10, 39),
	('db_shrug', 'Dumbbell shrug', 'upper', NULL, 'Straight up, 1 s hold at the top', 3, 12, 15, 15, 40),
	('reverse_lunge', 'Reverse lunge', 'lower', NULL, 'Step back, knee hovers just off the floor', 3, 8, 12, 10, 41),
	('sumo_squat', 'Sumo squat', 'lower', 'Wide stance, one dumbbell held at the chest or hanging', 'Knees track over toes, tall chest', 3, 10, 15, 12.5, 42),
	('russian_twist', 'Russian twist', 'full_body', 'Seated, heels light or lifted, dumbbell at the chest', 'Rotate from the trunk, not the arms', 3, 10, 20, 5, 43),
	('weighted_situp', 'Weighted sit-up', 'full_body', 'Dumbbell hugged to the chest', 'Slow down phase — 2-3 seconds', 3, 10, 15, 5, 44)
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
-- Arnold press progresses slowly, like the overhead press (smaller bumps).
UPDATE "strength_exercises" SET "slow_progressor" = true WHERE "slug" = 'arnold_press';


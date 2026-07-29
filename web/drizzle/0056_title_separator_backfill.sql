-- Backfill the separator in titles and plan names that were generated before
-- the app switched from an em dash to a middle dot.
--
-- Titles and plan names are baked onto the row at creation time, so the code
-- change alone only affects rows created after it shipped. Without this, the
-- two forms coexist indefinitely: two sessions in the same week can read
-- "Upper — Kraft" and "Upper · Kraft", and the same split shows up on the
-- watch and in the calendar, because both surfaces read the stored string.
--
-- Every statement is anchored to an exact form the generator produces, so no
-- athlete-entered text is in range. Renamed plans, custom workout titles and
-- imported activity names are all untouched: they cannot match these shapes.
--
-- Anchored regexp_replace rather than substring() offsets on purpose. An em
-- dash is three bytes in UTF-8, so any offset arithmetic is only correct
-- while it counts characters; a byte-wise equivalent would corrupt each row
-- it touched. Matching and rewriting the literal removes the question.
--
-- Each WHERE stops matching once its rows are rewritten, so the file is a
-- no-op on re-run. That matters here: the migration runner replays every
-- file on every build.

-- Strength session titles. Exactly five forms exist (SESSION_TEMPLATES in
-- lib/strength/program.ts), matched by equality rather than pattern.
UPDATE "strength_sessions"
SET "title" = replace("title", ' — ', ' · ')
WHERE "title" IN (
  'Upper — Kraft',
  'Lower — Kraft',
  'Achilles — Kraft',
  'Upper + Achilles — Kraft',
  'Lower + Achilles — Kraft'
);
--> statement-breakpoint

-- Race day workouts: "Race Day — 10K", "Race Day — Half Marathon", and the
-- custom "Race Day — 42.5 km". Gated on type so the prefix cannot reach a
-- workout that merely starts with those words.
UPDATE "workouts"
SET "title" = regexp_replace("title", '^Race Day — ', 'Race Day · ')
WHERE "type" = 'race'
  AND "title" LIKE 'Race Day — %';
--> statement-breakpoint

-- Intent plan names: "Get Fit — 8 weeks", "Maintain — 8 weeks",
-- "Return to Running — 8 weeks".
UPDATE "plans"
SET "name" = regexp_replace("name", '^(Get Fit|Maintain|Return to Running) — ', '\1 · ')
WHERE "name" ~ '^(Get Fit|Maintain|Return to Running) — ';
--> statement-breakpoint

-- Race goal plan names: "<distance> — <goal time> Goal", e.g.
-- "Half Marathon — 1:45:00 Goal". The distance label varies (including a
-- custom "42.5 km"), so the left side is matched generically and the whole
-- string is anchored on the " Goal" suffix.
--
-- The NOT LIKE guard skips any name carrying a second em dash. The generator
-- never produces one, so such a name has been renamed by the athlete and a
-- generic rewrite could land on the wrong separator.
UPDATE "plans"
SET "name" = regexp_replace("name", '^(.+) — (.+ Goal)$', '\1 · \2')
WHERE "name" ~ '^.+ — .+ Goal$'
  AND "name" NOT LIKE '%—%—%';

-- Plans gain an "intent": race (goal-time, peaks + tapers to a race day) vs the
-- non-race intents get_fit / maintain (no race day, no goal time). Existing rows
-- are all race plans. NOT NULL + default keeps every current reader working and
-- the column backfills to 'race'. Idempotent.
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "intent" text NOT NULL DEFAULT 'race';

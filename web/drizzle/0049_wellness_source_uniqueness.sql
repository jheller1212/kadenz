-- wellness_metrics was unique on (date) alone, so a second data source
-- (Apple Health, Health Connect) writing the same calendar night would
-- silently overwrite the Garmin row instead of coexisting with it. Move
-- uniqueness to (source, date) so every source gets its own row per night.
--
-- Dropping the date-only index is not destructive: an index carries no data
-- of its own, only a lookup structure, and every existing row already has
-- source = 'garmin' (the column default), so the new (source, date) index
-- cannot collide with anything that's there today.
DROP INDEX IF EXISTS "wellness_metrics_date_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wellness_metrics_source_date_uq" ON "wellness_metrics" ("source", "date");

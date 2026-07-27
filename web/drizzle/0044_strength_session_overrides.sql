-- Per-session equipment/duration overrides ("I'm at the gym today", "only
-- got 30 min today") — apply to that one session only, never written back to
-- strength_plan_settings. Null = no override, fall back to the profile's
-- default (see lib/strength/service.ts buildPlannedSession).
ALTER TABLE "strength_sessions" ADD COLUMN IF NOT EXISTS "equipment_override" text[];
ALTER TABLE "strength_sessions" ADD COLUMN IF NOT EXISTS "duration_override_minutes" integer;

-- When the athlete reported the Achilles complaint, which is the clock the HSR
-- calf ramp runs on.
--
-- hsrPrescriptionForWeek (lib/strength/program.ts) steps load and reps by
-- week: 2x15 kg for weeks 1-2, 2x20 kg for 3-4, single leg from week 5. It was
-- being handed the RUNNING plan's week number, which is a different clock
-- entirely. An athlete who first reports Achilles pain in week 14 of a
-- marathon block was started on the single-leg load on day one, and an athlete
-- who removed the complaint and re-reported it a month later resumed wherever
-- the running plan had got to rather than rebuilding the tendon's tolerance.
--
-- Now the ramp counts from this timestamp. It is set when "achilles" is added
-- to complaints and cleared when it is removed, so re-reporting restarts the
-- protocol at week 1. That is the deliberate choice: restarting costs a few
-- light weeks, resuming a ramp on a tendon that has not been loaded in a month
-- does not.
--
-- Backfilled to created_at for athletes who already report the complaint, so
-- their ramp continues from where their plan started instead of dropping back
-- to week 1 on deploy. NULL (no Achilles complaint) falls back to the running
-- plan week, which is the old behaviour and only ever reached by code paths
-- that have no Achilles work to prescribe.

ALTER TABLE "strength_plan_settings"
  ADD COLUMN IF NOT EXISTS "achilles_started_at" timestamptz;
--> statement-breakpoint

UPDATE "strength_plan_settings"
SET "achilles_started_at" = "created_at"
WHERE "achilles_started_at" IS NULL
  AND "complaints" IS NOT NULL
  AND 'achilles' = ANY("complaints");

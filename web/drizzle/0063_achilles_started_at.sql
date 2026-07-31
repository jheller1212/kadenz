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
-- Athletes who already report the complaint are backfilled to their active
-- running plan's start date, not to when they set Kraft up. That is the exact
-- anchor the old clock used, so nobody's ramp position moves on deploy: the
-- new clock reproduces the week they are on today and takes over from there.
-- Checked against the live data rather than assumed. The one athlete with the
-- complaint set Kraft up on 2026-07-14 and started their current plan on
-- 2026-07-27, so a created_at backfill would have jumped them from week 1
-- (2x15 kg) to week 3 (2x20 kg) overnight. Falls back to created_at only when
-- there is no active plan, where there was no plan week to preserve.
--
-- NULL (no Achilles complaint) falls back to the running plan week, which is
-- the old behaviour and only reached by code paths with no Achilles work to
-- prescribe.

ALTER TABLE "strength_plan_settings"
  ADD COLUMN IF NOT EXISTS "achilles_started_at" timestamptz;
--> statement-breakpoint

UPDATE "strength_plan_settings" ps
SET "achilles_started_at" = COALESCE(
  (
    SELECT p."start_date"
    FROM "plans" p
    WHERE p."user_id" = ps."user_id" AND p."status" = 'active'
    ORDER BY p."start_date" DESC
    LIMIT 1
  ),
  ps."created_at"
)
WHERE ps."achilles_started_at" IS NULL
  AND ps."complaints" IS NOT NULL
  AND 'achilles' = ANY(ps."complaints");

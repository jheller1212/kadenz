-- Achilles/HSR rehab is a frequency-and-spacing policy over the whole week,
-- not "attached to every session" (see the comment above
-- strength_sessions.achilles_attached in schema.ts, and program.ts's comment
-- above ACHILLES_COMPLAINT_SLOTS for the incident this closes: unconditional
-- injection meant an athlete with 4 strength days/week got the HSR block on
-- all 4 consecutive days, exactly what HSR (Heavy Slow Resistance) protocols
-- are built to avoid).
--
-- The weekly rehab-day scheduler (lib/strength/schedule.ts, reconcile.ts
-- computeAchillesRehabDays) picks ~3 non-consecutive days a week. On a chosen
-- day that already holds a plain upper/lower/full_body session, the block is
-- appended to that session (this flag) instead of creating a second session
-- on the same calendar day. On a chosen day with nothing scheduled, a
-- standalone "achilles" session is created instead (unaffected by this
-- column — its fixed template already carries the block).
--
-- Default false is correct for every existing row: no row created before
-- this migration was ever built with the block attached via this mechanism.
ALTER TABLE "strength_sessions"
  ADD COLUMN IF NOT EXISTS "achilles_attached" boolean NOT NULL DEFAULT false;

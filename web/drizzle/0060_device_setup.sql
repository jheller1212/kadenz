-- What the athlete wants connected, and whether they have been asked at all.
--
-- Onboarding assumed a device. It asked nothing about hardware, and every
-- downstream surface then behaved as though a watch were on its way: the
-- readiness card's warm-up copy says it is "building your recovery baseline
-- (n/21 days)", which for an athlete with no watch counts up from zero
-- forever. The app could not tell "still waiting for your device" apart from
-- "there is no device", because nobody had ever asked.
--
-- Two columns rather than a table: it is one answer per person, read by the
-- readiness endpoint on every Today load, and every caller already has the
-- user id in hand. Same reasoning as 0057's unit columns.
--
-- device_setup_at is the flag that matters. NULL means never asked, which is
-- the only state that prompts. A timestamp means answered, including answered
-- with an empty array, which is the athlete who records by hand. That is why
-- the answer cannot be inferred from device_connections alone: "chose nothing"
-- and "was never asked" are different, and only one of them should be nudged.
--
-- device_connections is jsonb rather than text[] because it is read straight
-- back as JSON by the API route and never queried by element. Values are the
-- CONNECTION_IDS in lib/device-setup.ts; unknown entries are dropped on read
-- rather than constrained here, so an id retired by a later build cannot make
-- an athlete's stored answer unreadable and start prompting them again.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "device_setup_at" timestamp with time zone;
--> statement-breakpoint

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "device_connections" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint

-- Array-shaped, so a reader can iterate without checking the type first. The
-- contents stay unconstrained on purpose (see above).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_device_connections_array_check') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_device_connections_array_check"
      CHECK (jsonb_typeof("device_connections") = 'array');
  END IF;
END $$;

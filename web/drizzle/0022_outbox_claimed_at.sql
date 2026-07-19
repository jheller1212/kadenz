ALTER TABLE "sync_outbox" ADD COLUMN IF NOT EXISTS "claimed_at" timestamp with time zone;

-- Native push. Until now every row in push_subscriptions was a Web Push
-- subscription: a browser-issued endpoint URL plus the p256dh/auth key pair
-- that web-push encrypts the payload with. The native shell registers a
-- Firebase Cloud Messaging token instead, which is a bare string with no key
-- pair, delivered over a completely different protocol.
--
-- The send path has to know which one it is holding, so record the transport
-- explicitly rather than inferring it from whether the endpoint parses as a
-- URL. Inference would guess, and a wrong guess means a reminder silently not
-- arriving, which is the exact failure the native work exists to remove.
ALTER TABLE "push_subscriptions"
  ADD COLUMN IF NOT EXISTS "transport" text NOT NULL DEFAULT 'web';
--> statement-breakpoint

-- Every row that existed before this migration is a Web Push subscription, and
-- the column default already labelled it 'web'. This is belt and braces for a
-- row inserted by an older deploy while the migration was in flight.
UPDATE "push_subscriptions" SET "transport" = 'web' WHERE "transport" IS NULL;
--> statement-breakpoint

-- FCM tokens have no encryption key pair, so these two stop being mandatory.
-- Widening a NOT NULL to nullable does not touch existing values.
ALTER TABLE "push_subscriptions" ALTER COLUMN "p256dh" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ALTER COLUMN "auth" DROP NOT NULL;
--> statement-breakpoint

-- Dropping the NOT NULL would otherwise let a malformed web subscription in
-- with no keys, which web-push cannot send to and which would fail at
-- delivery time rather than at write time. Keep the old guarantee for web
-- rows and require the opposite for native rows, so the shape of a row always
-- matches its transport.
DO $$
BEGIN
  ALTER TABLE "push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_transport_shape"
    CHECK (
      ("transport" = 'web' AND "p256dh" IS NOT NULL AND "auth" IS NOT NULL)
      OR ("transport" = 'fcm' AND "p256dh" IS NULL AND "auth" IS NULL)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- The cron reads every subscription on each run and then splits them by
-- transport. Cheap now with a handful of rows, but the split is the access
-- pattern, so give it an index before it is a table scan per reminder.
CREATE INDEX IF NOT EXISTS "push_subscriptions_transport_idx"
  ON "push_subscriptions" ("transport");

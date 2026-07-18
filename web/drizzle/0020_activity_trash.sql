-- Recently deleted activities: the full original row is kept as jsonb for 30
-- days so a delete in the Activities tab is recoverable. deleted_activities
-- tombstones (sync-skip) are unchanged and created alongside as before.
CREATE TABLE IF NOT EXISTS "activity_trash" (
  "id" uuid PRIMARY KEY,
  "payload" jsonb NOT NULL,
  "deleted_at" timestamp with time zone NOT NULL DEFAULT now()
);

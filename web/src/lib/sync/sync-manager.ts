// TODO: Outbox queue — persist pending sync operations to DB before executing
// TODO: Idempotent sync — each operation has a unique key, skip if already applied
// TODO: Retry logic with exponential backoff
// TODO: Sync targets: Google Calendar, Garmin Connect (via garmin-worker)
// TODO: Conflict resolution — external changes vs local changes

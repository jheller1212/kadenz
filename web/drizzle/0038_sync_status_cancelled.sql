-- A pending outbox job can be found to be stale before it ever runs (its
-- plan got archived, or its entity row is gone). "failed" would misreport
-- that a delivery attempt happened and errored; a bare row DELETE would
-- erase the audit trail of what got swept and why. "cancelled" is a new
-- terminal status for exactly this: never attempted, deliberately retired.
-- ADD VALUE runs outside a transaction and IF NOT EXISTS keeps it idempotent.
ALTER TYPE "sync_status" ADD VALUE IF NOT EXISTS 'cancelled';

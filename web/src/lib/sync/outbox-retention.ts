// ── How long a settled outbox row is worth keeping ──────────────────────────
//
// Nothing has ever deleted from sync_outbox. It accumulated ~1,800 rows going
// back to June — 1,400 of them delivered or deliberately cancelled months ago
// — and would have gone on growing forever. Every claim query filters on
// status and user, so the dead weight is not a correctness problem; it is a
// table that only ever gets bigger, and a slow leak of the kind nobody
// notices until it is large.
//
// Deliberately narrow about WHICH rows go:
//
//   completed  — delivered. There is nothing left to learn from it.
//   cancelled  — deliberately dropped, with the reason already recorded on the
//                row that mattered at the time (gcal-outbox-cleanup-rules).
//
// `failed` rows are kept regardless of age, on purpose. They are the record of
// something that did not work, the daily requeue can still resurrect one whose
// attempts are under the retry cap, and they are the first place to look when
// asking "why did this never reach my calendar?". Seventy-odd of them is not a
// storage problem; losing them would cost real diagnostic ground.
//
// `pending` and `processing` are live work and are never touched here.

export const OUTBOX_RETENTION_DAYS = 30;

/** Statuses safe to delete once old: settled, and carrying nothing to learn. */
export const PURGEABLE_STATUSES = ["completed", "cancelled"] as const;

export type PurgeableStatus = (typeof PURGEABLE_STATUSES)[number];

/**
 * The cutoff before which a settled row may be deleted.
 *
 * Takes `now` rather than reading the clock so the rule is testable without
 * faking time — the same reason the rest of this codebase threads timestamps
 * in rather than calling Date.now() deep inside a helper.
 */
export function retentionCutoff(now: Date, days: number = OUTBOX_RETENTION_DAYS): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/** True if a row is old enough AND settled enough to delete. */
export function isPurgeable(
  row: { status: string; createdAt: Date },
  now: Date,
  days: number = OUTBOX_RETENTION_DAYS
): boolean {
  return (
    (PURGEABLE_STATUSES as readonly string[]).includes(row.status) &&
    row.createdAt.getTime() < retentionCutoff(now, days).getTime()
  );
}

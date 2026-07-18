// Pure serialize/deserialize helpers for the activity trash (recently
// deleted). An activities row goes into activity_trash.payload as plain JSON
// (Dates → ISO strings) and comes back out as an insertable row (ISO strings →
// Dates). Keep this file DB-free so it stays unit-testable.

import type { activities } from "@/db/schema";

export type ActivityRow = typeof activities.$inferSelect;

/** activities columns stored as timestamptz — the only ones that need
 * Date ⇄ ISO-string conversion. splits/laps are already jsonb; the rest are
 * text/real/integer/uuid and survive JSON round-trips as-is. */
const TIMESTAMP_KEYS = ["startDate", "createdAt"] as const;

export function rowToPayload(row: ActivityRow): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const key of TIMESTAMP_KEYS) {
    const v = row[key];
    out[key] = v instanceof Date ? v.toISOString() : null;
  }
  return out;
}

export function payloadToRow(payload: Record<string, unknown>): ActivityRow {
  const out: Record<string, unknown> = { ...payload };
  for (const key of TIMESTAMP_KEYS) {
    const v = out[key];
    out[key] = typeof v === "string" ? new Date(v) : null;
  }
  // createdAt is NOT NULL — tolerate legacy payloads missing it.
  if (out.createdAt == null) out.createdAt = new Date();
  return out as ActivityRow;
}

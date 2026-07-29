// ── Per-set heart rate display (pure) ────────────────────────────────────────
// Turns a set's avgHr/maxHr (see lib/sync/strength-hr.ts alignSetHeartRate)
// into the short string shown next to the weight × reps figure on a logged
// set row. avgHr null means "no reading for this set" — never render 0 or a
// bare dash, so this returns null and the caller renders nothing.

export interface SetHrInput {
  avgHr: number | null;
  maxHr: number | null;
}

export function formatSetHr({ avgHr, maxHr }: SetHrInput): string | null {
  if (avgHr == null) return null;
  if (maxHr != null && maxHr !== avgHr) return `${avgHr} bpm avg, ${maxHr} max`;
  return `${avgHr} bpm`;
}

// Pure formatting for the Strava sync result banner in
// settings/apps/page.tsx. Pulled out so the copy (and the bug class where a
// capability ships with no visible feedback) has a test that doesn't need a
// browser — see strava-activity-fields.ts for the same pattern.

export interface SyncTally {
  inserted: number;
  refreshed: number;
  alreadySynced: number;
  oldest: string | null;
}

function formatOldest(oldest: string | null): string {
  if (!oldest) return "";
  const date = new Date(oldest).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return ` · history back to ${date}`;
}

/** Result text for a completed (non-rate-limited) sync. `full` selects "Sync entire history" scope. */
export function formatSyncResult(tally: SyncTally, full: boolean): string {
  const scope = full ? "" : "Last 30 days: ";
  const oldest = formatOldest(tally.oldest);
  if (tally.inserted === 0 && tally.refreshed === 0) {
    const checked = tally.alreadySynced ? ` (${tally.alreadySynced} checked)` : "";
    return `${scope}Up to date, no changes${checked}${oldest}.`;
  }
  const parts: string[] = [];
  if (tally.inserted) {
    parts.push(`${tally.inserted} new ${tally.inserted === 1 ? "activity" : "activities"}`);
  }
  if (tally.refreshed) parts.push(`${tally.refreshed} repaired`);
  return `${scope}Synced ${parts.join(", ")}${oldest}.`;
}

/** Result text when Strava's rate limit cut the run short. */
export function formatRateLimitedResult(tally: SyncTally, full: boolean): string {
  const scope = full ? "" : "Last 30 days: ";
  const repaired = tally.refreshed ? `, repaired ${tally.refreshed}` : "";
  return `${scope}Imported ${tally.inserted}${repaired}. Strava's rate limit reached, run again in ~15 minutes to continue where it left off.`;
}

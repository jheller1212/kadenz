import { describe, it, expect } from "vitest";
import { formatSyncResult, formatRateLimitedResult, type SyncTally } from "../strava-sync-result";

function tally(overrides: Partial<SyncTally> = {}): SyncTally {
  return { inserted: 0, refreshed: 0, alreadySynced: 0, oldest: null, ...overrides };
}

describe("formatSyncResult", () => {
  it("reports repairs, not just inserts, for a plain 30 day sync", () => {
    // This is the exact scenario from the bug report: an edit on Strava with
    // nothing new to insert must still show up as a repair.
    const text = formatSyncResult(tally({ refreshed: 1 }), false);
    expect(text).toBe("Last 30 days: Synced 1 repaired.");
  });

  it("reports both inserts and repairs together", () => {
    const text = formatSyncResult(tally({ inserted: 2, refreshed: 1 }), false);
    expect(text).toBe("Last 30 days: Synced 2 new activities, 1 repaired.");
  });

  it("says up to date with nothing to report", () => {
    const text = formatSyncResult(tally({ alreadySynced: 5 }), false);
    expect(text).toBe("Last 30 days: Up to date, no changes (5 checked).");
  });

  it("omits the scope prefix for full history", () => {
    const text = formatSyncResult(tally({ inserted: 3 }), true);
    expect(text).toBe("Synced 3 new activities.");
  });

  it("appends the oldest-activity date when known", () => {
    const text = formatSyncResult(tally({ inserted: 1, oldest: "2026-01-05T10:00:00Z" }), true);
    expect(text).toBe("Synced 1 new activity · history back to 5 Jan 2026.");
  });

  it("uses singular activity wording for exactly one insert", () => {
    const text = formatSyncResult(tally({ inserted: 1 }), false);
    expect(text).toBe("Last 30 days: Synced 1 new activity.");
  });
});

describe("formatRateLimitedResult", () => {
  it("includes repairs alongside inserts when the run is cut short", () => {
    const text = formatRateLimitedResult(tally({ inserted: 4, refreshed: 2 }), false);
    expect(text).toBe(
      "Last 30 days: Imported 4, repaired 2. Strava's rate limit reached, run again in ~15 minutes to continue where it left off."
    );
  });

  it("omits the repaired clause when nothing was refreshed", () => {
    const text = formatRateLimitedResult(tally({ inserted: 4 }), true);
    expect(text).toBe(
      "Imported 4. Strava's rate limit reached, run again in ~15 minutes to continue where it left off."
    );
  });
});

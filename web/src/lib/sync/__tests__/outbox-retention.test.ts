import { describe, expect, it } from "vitest";
import {
  isPurgeable,
  retentionCutoff,
  OUTBOX_RETENTION_DAYS,
  PURGEABLE_STATUSES,
} from "../outbox-retention";

const NOW = new Date("2026-08-18T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe("outbox retention", () => {
  it("keeps settled rows until they are older than the window", () => {
    expect(isPurgeable({ status: "completed", createdAt: daysAgo(29) }, NOW)).toBe(false);
    expect(isPurgeable({ status: "completed", createdAt: daysAgo(31) }, NOW)).toBe(true);
  });

  it("never deletes a failed row, however old", () => {
    // These are the record of something that did not work, the daily requeue
    // can still resurrect one under the retry cap, and they are the first
    // place to look when a calendar event never arrived.
    expect(isPurgeable({ status: "failed", createdAt: daysAgo(365) }, NOW)).toBe(false);
  });

  it("never deletes live work, however old", () => {
    // An old pending row means delivery is overdue, not that it is disposable
    // — one sat pending for four days during a dead Google grant.
    expect(isPurgeable({ status: "pending", createdAt: daysAgo(365) }, NOW)).toBe(false);
    expect(isPurgeable({ status: "processing", createdAt: daysAgo(365) }, NOW)).toBe(false);
  });

  it("deletes cancelled rows on the same terms as completed ones", () => {
    expect(isPurgeable({ status: "cancelled", createdAt: daysAgo(31) }, NOW)).toBe(true);
  });

  it("only ever admits statuses that are genuinely settled", () => {
    // Guards the list itself: adding "pending" or "failed" here would make
    // every test above pass while quietly deleting live or diagnostic rows.
    expect([...PURGEABLE_STATUSES].sort()).toEqual(["cancelled", "completed"]);
  });

  it("computes the cutoff from the supplied clock, not the real one", () => {
    expect(retentionCutoff(NOW).toISOString()).toBe("2026-07-19T12:00:00.000Z");
    expect(retentionCutoff(NOW, 1).toISOString()).toBe("2026-08-17T12:00:00.000Z");
    expect(OUTBOX_RETENTION_DAYS).toBe(30);
  });
});

import { describe, expect, it } from "vitest";
import { isStaleClaim, STALE_CLAIM_MS } from "../outbox-claims";

describe("isStaleClaim", () => {
  const now = new Date("2026-07-19T12:00:00Z");

  it("ignores jobs that are not processing", () => {
    expect(isStaleClaim({ status: "pending", claimedAt: null }, now)).toBe(false);
    expect(isStaleClaim({ status: "completed", claimedAt: null }, now)).toBe(false);
    expect(isStaleClaim({ status: "failed", claimedAt: new Date(0) }, now)).toBe(false);
  });

  it("reclaims legacy processing rows with no claim timestamp", () => {
    expect(isStaleClaim({ status: "processing", claimedAt: null }, now)).toBe(true);
  });

  it("leaves a freshly claimed job alone", () => {
    const justNow = new Date(now.getTime() - 1000);
    expect(isStaleClaim({ status: "processing", claimedAt: justNow }, now)).toBe(false);
  });

  it("reclaims a job abandoned past the staleness window", () => {
    const old = new Date(now.getTime() - STALE_CLAIM_MS - 1);
    expect(isStaleClaim({ status: "processing", claimedAt: old }, now)).toBe(true);
  });
});

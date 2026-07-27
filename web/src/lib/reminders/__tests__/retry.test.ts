import { describe, expect, it } from "vitest";
import { isRetryEligible, MAX_REMINDER_ATTEMPTS, STALE_PENDING_MS, type SentReminderRow } from "../retry";

const SCHEDULED_AT = new Date("2026-07-20T06:00:00.000Z");
const NOW = new Date("2026-07-20T05:45:00.000Z"); // 15 min before start

function row(overrides: Partial<SentReminderRow> = {}): SentReminderRow {
  return {
    status: "failed",
    attempts: 1,
    lastAttemptAt: new Date("2026-07-20T05:40:00.000Z"),
    ...overrides,
  };
}

describe("isRetryEligible", () => {
  it("never retries a reminder that already sent", () => {
    expect(isRetryEligible(row({ status: "sent" }), NOW, SCHEDULED_AT)).toBe(false);
  });

  it("retries a transient failure while inside the window", () => {
    expect(isRetryEligible(row({ status: "failed" }), NOW, SCHEDULED_AT)).toBe(true);
  });

  it("stops retrying a transient failure once the workout has started", () => {
    const afterStart = new Date(SCHEDULED_AT.getTime() + 1);
    expect(isRetryEligible(row({ status: "failed" }), afterStart, SCHEDULED_AT)).toBe(false);
  });

  it("stops retrying a transient failure right at the workout start instant", () => {
    expect(isRetryEligible(row({ status: "failed" }), SCHEDULED_AT, SCHEDULED_AT)).toBe(false);
  });

  it("never retries a permanent failure (every subscription gone)", () => {
    expect(isRetryEligible(row({ status: "permanent" }), NOW, SCHEDULED_AT)).toBe(false);
  });

  it("caps the number of attempts", () => {
    expect(
      isRetryEligible(row({ status: "failed", attempts: MAX_REMINDER_ATTEMPTS }), NOW, SCHEDULED_AT)
    ).toBe(false);
    expect(
      isRetryEligible(row({ status: "failed", attempts: MAX_REMINDER_ATTEMPTS - 1 }), NOW, SCHEDULED_AT)
    ).toBe(true);
  });

  it("does not retry a claim that's still genuinely in flight", () => {
    const justClaimed = row({ status: "pending", lastAttemptAt: new Date(NOW.getTime() - 1_000) });
    expect(isRetryEligible(justClaimed, NOW, SCHEDULED_AT)).toBe(false);
  });

  it("treats a stale pending claim (crashed mid-send) as retryable", () => {
    const stale = row({
      status: "pending",
      lastAttemptAt: new Date(NOW.getTime() - STALE_PENDING_MS - 1),
    });
    expect(isRetryEligible(stale, NOW, SCHEDULED_AT)).toBe(true);
  });

  it("does not yet treat a pending claim right at the staleness boundary minus one as retryable", () => {
    const justUnderThreshold = row({
      status: "pending",
      lastAttemptAt: new Date(NOW.getTime() - STALE_PENDING_MS + 1),
    });
    expect(isRetryEligible(justUnderThreshold, NOW, SCHEDULED_AT)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { todayEmptyState } from "../today-empty-state";

describe("todayEmptyState", () => {
  it("shows the Kraft screen when there is no running plan but Kraft is on", () => {
    // The bug. This combination rendered "Ready to train? Create a
    // personalised race plan" — to an athlete with strength sessions on their
    // watch that week.
    expect(todayEmptyState({ kraftActive: true })).toBe("kraft-running");
  });

  it("offers both plans when neither exists", () => {
    expect(todayEmptyState({ kraftActive: false })).toBe("nothing");
  });

  it("prefers the error state over either, even with Kraft on", () => {
    // A failed load must not be dressed up as "you have no plan": that invites
    // building a second plan on top of one that merely failed to fetch.
    expect(todayEmptyState({ error: true, kraftActive: true })).toBe("error");
    expect(todayEmptyState({ error: true, kraftActive: false })).toBe("error");
  });

  it("does not claim Kraft is running before bootstrap has answered", () => {
    // null is "not known yet". Guessing "kraft-running" would flash a claim
    // that may be false a moment later.
    expect(todayEmptyState({ kraftActive: null })).toBe("nothing");
    expect(todayEmptyState({})).toBe("nothing");
  });
});

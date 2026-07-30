import { describe, expect, it } from "vitest";
import { formatLoad } from "../weights";

// formatLoad used to resolve the weight unit from localStorage only. Server
// callers (the calendar event the cron writes) have no localStorage, so they
// silently got kg no matter what the athlete had chosen. These cover the
// explicit unit that closed that gap.
describe("formatLoad unit override", () => {
  it("renders kg when told to", () => {
    expect(formatLoad(20, { unit: "kg" })).toBe("20 kg × 2 · one per hand");
  });

  it("converts to lbs when told to", () => {
    expect(formatLoad(20, { unit: "lbs" })).toBe("44 lbs × 2 · one per hand");
  });

  it("defaults to kg when no unit is given, which is what a server caller sees", () => {
    expect(formatLoad(20)).toBe("20 kg × 2 · one per hand");
  });

  it("says bodyweight regardless of unit", () => {
    expect(formatLoad(0, { unit: "lbs" })).toBe("Bodyweight");
    expect(formatLoad(null, { unit: "lbs", perSide: true })).toBe("Bodyweight · each side");
  });
});

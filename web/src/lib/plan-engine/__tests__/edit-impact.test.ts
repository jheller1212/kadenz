import { describe, it, expect } from "vitest";
import { isMaterialEdit } from "../edit-impact";

describe("isMaterialEdit", () => {
  it("is never material for a non-key session, however big the change", () => {
    expect(
      isMaterialEdit({ type: "easy", originalTargetKm: 8, newTargetKm: 2, paceOffsetSecKm: 0 })
    ).toBe(false);
  });

  it("flags a big distance cut on a long run", () => {
    expect(
      isMaterialEdit({ type: "long", originalTargetKm: 16, newTargetKm: 12, paceOffsetSecKm: 0 })
    ).toBe(true);
  });

  it("does not flag a small distance nudge on a long run", () => {
    expect(
      isMaterialEdit({ type: "long", originalTargetKm: 16, newTargetKm: 15, paceOffsetSecKm: 0 })
    ).toBe(false);
  });

  it("flags a large pace offset on a tempo session even with no distance change", () => {
    expect(
      isMaterialEdit({ type: "tempo", originalTargetKm: 8, newTargetKm: 8, paceOffsetSecKm: 25 })
    ).toBe(true);
  });

  it("does not flag a small pace offset", () => {
    expect(
      isMaterialEdit({ type: "interval", originalTargetKm: 10, newTargetKm: 10, paceOffsetSecKm: 10 })
    ).toBe(false);
  });

  it("treats a negative pace offset the same as a positive one", () => {
    expect(
      isMaterialEdit({ type: "interval", originalTargetKm: 10, newTargetKm: 10, paceOffsetSecKm: -25 })
    ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { formatSetHr } from "../format-set-hr";

describe("formatSetHr", () => {
  it("returns null when there is no average reading", () => {
    expect(formatSetHr({ avgHr: null, maxHr: null })).toBeNull();
    expect(formatSetHr({ avgHr: null, maxHr: 150 })).toBeNull();
  });

  it("shows only the average when max is missing or equal", () => {
    expect(formatSetHr({ avgHr: 132, maxHr: null })).toBe("132 bpm");
    expect(formatSetHr({ avgHr: 132, maxHr: 132 })).toBe("132 bpm");
  });

  it("shows average and max when they differ", () => {
    expect(formatSetHr({ avgHr: 132, maxHr: 145 })).toBe("132 bpm avg, 145 max");
  });

  it("never renders 0 as a reading", () => {
    // avgHr of 0 would be falsy-but-not-null — must still be treated as a
    // real (if implausible) reading, not silently dropped or shown as "—".
    expect(formatSetHr({ avgHr: 0, maxHr: null })).toBe("0 bpm");
  });
});

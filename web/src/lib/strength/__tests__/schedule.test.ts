import { describe, expect, it } from "vitest";
import { pickSpreadDays } from "../schedule";

describe("pickSpreadDays", () => {
  it("returns all days when availability is scarce", () => {
    expect(pickSpreadDays([1, 3], 3)).toEqual([1, 3]);
  });

  it("spreads picks across the available range", () => {
    expect(pickSpreadDays([1, 2, 3, 4, 5], 2)).toEqual([1, 5]);
    expect(pickSpreadDays([1, 2, 3, 4, 5], 3)).toEqual([1, 3, 5]);
  });

  it("dedupes and tops up on rounding collisions", () => {
    const out = pickSpreadDays([1, 2, 3], 3);
    expect(out).toEqual([1, 2, 3]);
    const two = pickSpreadDays([0, 6], 2);
    expect(two).toEqual([0, 6]);
  });
});

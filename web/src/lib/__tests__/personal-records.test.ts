import { describe, it, expect } from "vitest";
import { pickPrDistance, isNewPersonalRecord } from "../personal-records";

describe("pickPrDistance", () => {
  it("maps every standard race distance to its personal_records bucket", () => {
    expect(pickPrDistance("5k")).toBe("5k");
    expect(pickPrDistance("10k")).toBe("10k");
    expect(pickPrDistance("half")).toBe("half");
    expect(pickPrDistance("marathon")).toBe("marathon");
  });

  it("has no bucket for ultra or custom distances", () => {
    expect(pickPrDistance("ultra")).toBeNull();
    expect(pickPrDistance("custom")).toBeNull();
  });
});

describe("isNewPersonalRecord", () => {
  it("is a new record when there is nothing on file yet", () => {
    expect(isNewPersonalRecord(null, 1500)).toBe(true);
  });

  it("is a new record when the candidate is faster (fewer seconds)", () => {
    expect(isNewPersonalRecord(1600, 1500)).toBe(true);
  });

  it("is not a new record when the candidate is slower", () => {
    expect(isNewPersonalRecord(1400, 1500)).toBe(false);
  });

  it("is not a new record on an exact tie", () => {
    expect(isNewPersonalRecord(1500, 1500)).toBe(false);
  });
});

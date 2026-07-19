import { describe, expect, it } from "vitest";
import { blockWeekBudget, blockWeekNumber, isDeloadWeek } from "../block";

const start = new Date("2026-08-03T12:00:00.000Z"); // a Monday

describe("blockWeekNumber", () => {
  it("counts weeks from the block's Monday", () => {
    expect(blockWeekNumber(new Date("2026-08-03T12:00:00Z"), start, 12)).toBe(1);
    expect(blockWeekNumber(new Date("2026-08-09T12:00:00Z"), start, 12)).toBe(1);
    expect(blockWeekNumber(new Date("2026-08-10T12:00:00Z"), start, 12)).toBe(2);
  });

  it("anchors to the Monday even when the block starts mid-week", () => {
    const wed = new Date("2026-08-05T12:00:00.000Z");
    expect(blockWeekNumber(new Date("2026-08-03T12:00:00Z"), wed, 12)).toBe(1);
  });

  it("returns null outside the block", () => {
    expect(blockWeekNumber(new Date("2026-07-27T12:00:00Z"), start, 12)).toBeNull();
    expect(blockWeekNumber(new Date("2026-11-02T12:00:00Z"), start, 12)).toBeNull();
  });
});

describe("isDeloadWeek", () => {
  it("deloads every fourth week", () => {
    expect(isDeloadWeek(4, 12)).toBe(true);
    expect(isDeloadWeek(8, 12)).toBe(true);
    expect(isDeloadWeek(3, 12)).toBe(false);
  });

  it("always deloads the final week of a block", () => {
    expect(isDeloadWeek(10, 10)).toBe(true);
  });
});

describe("blockWeekBudget", () => {
  it("gives normal weeks the full rotation", () => {
    expect(blockWeekBudget(2, 12, 3)).toBe(3);
  });

  it("drops one session in a deload week", () => {
    expect(blockWeekBudget(4, 12, 3)).toBe(2);
  });

  it("keeps at least one session for a once-a-week plan", () => {
    expect(blockWeekBudget(4, 12, 1)).toBe(1);
  });

  it("schedules nothing outside the block", () => {
    expect(blockWeekBudget(null, 12, 3)).toBe(0);
  });
});

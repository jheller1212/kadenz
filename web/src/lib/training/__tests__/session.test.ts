import { describe, it, expect } from "vitest";
import { isPastDuePlanned } from "../session";

// A workout row is stored at midnight, so an instant comparison marked today's
// session "past due" from 00:01 and the plan screen showed it as missed while
// the athlete still had the whole day to train. These pin the day-granularity
// behaviour so that cannot come back.
describe("isPastDuePlanned", () => {
  const midMorning = new Date("2026-07-27T09:30:00.000Z");

  it("does not treat today's planned session as missed", () => {
    const today = { status: "planned" as const, date: new Date("2026-07-27T00:00:00.000Z") };
    expect(isPastDuePlanned(today, midMorning)).toBe(false);
  });

  it("still treats today's session as pending late in the evening", () => {
    const today = { status: "planned" as const, date: new Date("2026-07-27T00:00:00.000Z") };
    const lateEvening = new Date("2026-07-27T21:45:00.000Z");
    expect(isPastDuePlanned(today, lateEvening)).toBe(false);
  });

  it("treats yesterday's planned session as missed", () => {
    const yesterday = { status: "planned" as const, date: new Date("2026-07-26T00:00:00.000Z") };
    expect(isPastDuePlanned(yesterday, midMorning)).toBe(true);
  });

  it("does not treat a future session as missed", () => {
    const tomorrow = { status: "planned" as const, date: new Date("2026-07-28T00:00:00.000Z") };
    expect(isPastDuePlanned(tomorrow, midMorning)).toBe(false);
  });

  it("only applies to planned sessions", () => {
    const done = { status: "completed" as const, date: new Date("2026-07-26T00:00:00.000Z") };
    const skipped = { status: "skipped" as const, date: new Date("2026-07-26T00:00:00.000Z") };
    expect(isPastDuePlanned(done, midMorning)).toBe(false);
    expect(isPastDuePlanned(skipped, midMorning)).toBe(false);
  });
});

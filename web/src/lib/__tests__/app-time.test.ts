import { describe, expect, it } from "vitest";
import {
  isSameLocalDay,
  localDayKey,
  localDow,
  localWeekRange,
  localWeekdayIndex,
} from "../app-time";

describe("localDayKey", () => {
  it("uses the athlete's calendar, not the server's UTC one", () => {
    // 00:30 on 20 July in Amsterdam is still 22:30 on 19 July UTC.
    const justAfterLocalMidnight = new Date("2026-07-19T22:30:00.000Z");
    expect(localDayKey(justAfterLocalMidnight)).toBe("2026-07-20");
  });

  it("agrees with UTC in the middle of the day", () => {
    expect(localDayKey(new Date("2026-07-19T12:00:00.000Z"))).toBe("2026-07-19");
  });

  it("handles winter time too", () => {
    // 00:30 CET on 15 Jan = 23:30 UTC on 14 Jan.
    expect(localDayKey(new Date("2026-01-14T23:30:00.000Z"))).toBe("2026-01-15");
  });
});

describe("localDow / localWeekdayIndex", () => {
  it("reports the local weekday just after local midnight", () => {
    // Local Monday 20 July, 00:30 — UTC still says Sunday.
    const d = new Date("2026-07-19T22:30:00.000Z");
    expect(localDow(d)).toBe(1); // Monday
    expect(localWeekdayIndex(d)).toBe(0); // Monday-based
  });

  it("maps Sunday to the end of the week", () => {
    const sunday = new Date("2026-07-19T12:00:00.000Z");
    expect(localDow(sunday)).toBe(0);
    expect(localWeekdayIndex(sunday)).toBe(6);
  });
});

describe("localWeekRange", () => {
  it("brackets the local Mon–Sun week", () => {
    const { weekStart, weekEnd } = localWeekRange(new Date("2026-07-22T12:00:00.000Z"));
    expect(localDayKey(weekStart)).toBe("2026-07-20");
    expect(weekEnd.toISOString().slice(0, 10)).toBe("2026-07-26");
  });

  it("rolls to the new week at local midnight, not UTC midnight", () => {
    // 00:30 local on Monday 20 July: the week must already be 20–26 July.
    const { weekStart } = localWeekRange(new Date("2026-07-19T22:30:00.000Z"));
    expect(weekStart.toISOString().slice(0, 10)).toBe("2026-07-20");
  });

  it("keeps Sunday in the week that started on Monday", () => {
    const { weekStart } = localWeekRange(new Date("2026-07-26T12:00:00.000Z"));
    expect(weekStart.toISOString().slice(0, 10)).toBe("2026-07-20");
  });
});

describe("isSameLocalDay", () => {
  it("treats the small hours as the new local day", () => {
    const lateUtc = new Date("2026-07-19T22:30:00.000Z"); // 00:30 local, 20 Jul
    const nextNoon = new Date("2026-07-20T12:00:00.000Z");
    expect(isSameLocalDay(lateUtc, nextNoon)).toBe(true);
  });
});

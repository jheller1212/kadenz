import { describe, expect, it } from "vitest";
import {
  runSessionLoad,
  averageWorkingRpe,
  strengthSessionLoad,
  weeklyLoadTrend,
} from "../training-load";

describe("runSessionLoad (session-RPE: RPE x duration minutes)", () => {
  it("matches the hand-computed session-RPE product", () => {
    // RPE 6, 40 min run -> 6 * 40 = 240 AU
    expect(runSessionLoad(6, 40 * 60)).toBe(240);
  });

  it("is null when RPE is missing", () => {
    expect(runSessionLoad(null, 1800)).toBeNull();
    expect(runSessionLoad(undefined, 1800)).toBeNull();
  });

  it("is null when duration is missing or non-positive", () => {
    expect(runSessionLoad(6, null)).toBeNull();
    expect(runSessionLoad(6, 0)).toBeNull();
    expect(runSessionLoad(6, -10)).toBeNull();
  });

  it("is null when RPE is non-positive", () => {
    expect(runSessionLoad(0, 1800)).toBeNull();
  });
});

describe("averageWorkingRpe", () => {
  it("averages working sets and excludes warm-ups", () => {
    const sets = [
      { rpe: 5, kind: "warmup" },
      { rpe: 7, kind: "working" },
      { rpe: 9, kind: null }, // null kind reads as working
    ];
    // (7 + 9) / 2 = 8, warm-up's 5 excluded
    expect(averageWorkingRpe(sets)).toBe(8);
  });

  it("is null when no working set has an RPE", () => {
    expect(averageWorkingRpe([{ rpe: null, kind: "working" }])).toBeNull();
    expect(averageWorkingRpe([{ rpe: 8, kind: "warmup" }])).toBeNull();
    expect(averageWorkingRpe([])).toBeNull();
  });
});

describe("strengthSessionLoad", () => {
  it("matches avg working RPE x duration minutes", () => {
    const sets = [
      { rpe: 6, kind: "working" },
      { rpe: 8, kind: "working" },
    ];
    // avg RPE 7, 50 min session -> 7 * 50 = 350 AU
    expect(strengthSessionLoad(sets, 50 * 60)).toBe(350);
  });

  it("is null when the session has no RPE input", () => {
    const sets = [{ rpe: null, kind: "working" }];
    expect(strengthSessionLoad(sets, 3000)).toBeNull();
  });

  it("is null when the session has no recorded duration", () => {
    const sets = [{ rpe: 7, kind: "working" }];
    expect(strengthSessionLoad(sets, null)).toBeNull();
    expect(strengthSessionLoad(sets, 0)).toBeNull();
  });
});

describe("weeklyLoadTrend", () => {
  it("sums load into the correct Monday-start week", () => {
    // Wednesday 2026-07-15 and Friday 2026-07-17 are the same ISO week
    // (Monday 2026-07-13).
    const entries = [
      { date: new Date("2026-07-15T10:00:00"), load: 100 },
      { date: new Date("2026-07-17T10:00:00"), load: 50 },
    ];
    const trend = weeklyLoadTrend(entries, 2, new Date("2026-07-20T00:00:00"));
    const thisWeek = trend.find((w) => w.weekStart === "2026-07-13");
    expect(thisWeek?.load).toBe(150);
    expect(thisWeek?.sessions).toBe(2);
  });

  it("gives a week with no qualifying sessions zero load, not an average", () => {
    const entries = [{ date: new Date("2026-07-15T10:00:00"), load: 100 }];
    const trend = weeklyLoadTrend(entries, 3, new Date("2026-07-20T00:00:00"));
    // The week before 2026-07-15's week (2026-07-06) has nothing in `entries`.
    const empty = trend.find((w) => w.weekStart === "2026-07-06");
    expect(empty?.load).toBe(0);
    expect(empty?.sessions).toBe(0);
  });

  it("ignores entries outside the requested window", () => {
    const entries = [
      { date: new Date("2020-01-01T10:00:00"), load: 999 },
      { date: new Date("2026-07-15T10:00:00"), load: 100 },
    ];
    const trend = weeklyLoadTrend(entries, 2, new Date("2026-07-20T00:00:00"));
    const total = trend.reduce((s, w) => s + w.load, 0);
    expect(total).toBe(100);
  });
});

import { describe, expect, it } from "vitest";
import {
  listEligibleWeeksToSkip,
  pickDefaultWeekToSkip,
  whyNotSkippable,
  type SkipCandidateWeek,
} from "../week-skip";

function makeWeek(
  overrides: Partial<SkipCandidateWeek> & { weekNumber: number; startOffsetDays: number }
): SkipCandidateWeek {
  const start = new Date("2025-01-06T00:00:00.000Z"); // Monday
  start.setUTCDate(start.getUTCDate() + overrides.startOffsetDays);
  return {
    id: `week-${overrides.weekNumber}`,
    weekNumber: overrides.weekNumber,
    phase: overrides.phase ?? "base",
    skippedAt: overrides.skippedAt ?? null,
    workouts:
      overrides.workouts ??
      Array.from({ length: 4 }, (_, i) => ({
        id: `w${overrides.weekNumber}-${i}`,
        date: new Date(start.getTime() + i * 86_400_000),
        status: "planned",
      })),
  };
}

const NOW = new Date("2025-01-20T12:00:00.000Z"); // Monday of week 3 (offset 14)

describe("whyNotSkippable — phase protection", () => {
  it("refuses a peak week", () => {
    const week = makeWeek({ weekNumber: 5, startOffsetDays: 28, phase: "peak" });
    expect(whyNotSkippable(week, NOW)).toMatch(/peak/i);
  });

  it("refuses a taper week", () => {
    const week = makeWeek({ weekNumber: 6, startOffsetDays: 35, phase: "taper" });
    expect(whyNotSkippable(week, NOW)).toMatch(/taper|race/i);
  });

  it("allows a base week", () => {
    const week = makeWeek({ weekNumber: 3, startOffsetDays: 14, phase: "base" });
    expect(whyNotSkippable(week, NOW)).toBeNull();
  });

  it("allows a build week", () => {
    const week = makeWeek({ weekNumber: 4, startOffsetDays: 21, phase: "build" });
    expect(whyNotSkippable(week, NOW)).toBeNull();
  });

  it("refuses a week already skipped", () => {
    const week = makeWeek({
      weekNumber: 3,
      startOffsetDays: 14,
      phase: "base",
      skippedAt: new Date("2025-01-15T00:00:00.000Z"),
    });
    expect(whyNotSkippable(week, NOW)).toMatch(/already skipped/i);
  });

  it("refuses a week that has already finished", () => {
    const week = makeWeek({ weekNumber: 1, startOffsetDays: 0, phase: "base" });
    expect(whyNotSkippable(week, NOW)).toMatch(/already finished/i);
  });
});

describe("listEligibleWeeksToSkip", () => {
  it("excludes peak, taper and race weeks even when they are the only future weeks", () => {
    const weeks: SkipCandidateWeek[] = [
      makeWeek({ weekNumber: 1, startOffsetDays: 0, phase: "base" }), // past
      makeWeek({ weekNumber: 2, startOffsetDays: 7, phase: "base" }), // past
      makeWeek({ weekNumber: 3, startOffsetDays: 14, phase: "peak" }),
      makeWeek({ weekNumber: 4, startOffsetDays: 21, phase: "taper" }),
      makeWeek({ weekNumber: 5, startOffsetDays: 28, phase: "taper" }), // race week
    ];
    const eligible = listEligibleWeeksToSkip(weeks, NOW);
    expect(eligible).toHaveLength(0);
  });

  it("returns only base/build weeks that have not finished yet, soonest first", () => {
    const weeks: SkipCandidateWeek[] = [
      makeWeek({ weekNumber: 1, startOffsetDays: 0, phase: "base" }), // past
      makeWeek({ weekNumber: 3, startOffsetDays: 14, phase: "base" }), // current
      makeWeek({ weekNumber: 4, startOffsetDays: 21, phase: "build" }),
      makeWeek({ weekNumber: 5, startOffsetDays: 28, phase: "peak" }),
    ];
    const eligible = listEligibleWeeksToSkip(weeks, NOW);
    expect(eligible.map((w) => w.weekNumber)).toEqual([3, 4]);
  });
});

describe("pickDefaultWeekToSkip", () => {
  it("prefers the week already in progress over a later one", () => {
    const weeks: SkipCandidateWeek[] = [
      makeWeek({ weekNumber: 3, startOffsetDays: 14, phase: "base" }), // current
      makeWeek({ weekNumber: 4, startOffsetDays: 21, phase: "build" }),
    ];
    const eligible = listEligibleWeeksToSkip(weeks, NOW);
    const picked = pickDefaultWeekToSkip(eligible, NOW);
    expect(picked?.weekNumber).toBe(3);
  });

  it("falls forward to the next base/build week when the current week is protected", () => {
    const weeks: SkipCandidateWeek[] = [
      makeWeek({ weekNumber: 3, startOffsetDays: 14, phase: "peak" }), // current, protected
      makeWeek({ weekNumber: 4, startOffsetDays: 21, phase: "build" }),
    ];
    const eligible = listEligibleWeeksToSkip(weeks, NOW);
    const picked = pickDefaultWeekToSkip(eligible, NOW);
    expect(picked?.weekNumber).toBe(4);
  });

  it("returns null when nothing is eligible", () => {
    expect(pickDefaultWeekToSkip([], NOW)).toBeNull();
  });
});

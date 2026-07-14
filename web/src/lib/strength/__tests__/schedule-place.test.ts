import { describe, expect, it } from "vitest";
import { placeStrengthWeek, type PlacementDay } from "../schedule-place";

// Mon..Sun week helper: runs = { dowIdx: runType }
function week(runs: Record<number, string>, taken: number[] = []): PlacementDay[] {
  const dows = [1, 2, 3, 4, 5, 6, 0];
  return dows.map((dow, i) => ({
    key: `d${i}`, // Monday=d0 … Sunday=d6
    dow,
    runType: runs[i] ?? null,
    nextDayRunType: runs[i + 1] ?? null,
    taken: taken.includes(i),
  }));
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

describe("placeStrengthWeek", () => {
  it("keeps heavy legs off hard-run days and the day before", () => {
    // Tue interval, Sat long run.
    const days = week({ 1: "interval", 5: "long" });
    const placed = placeStrengthWeek(days, ALL_DAYS, ["lower_achilles", "full_body"]);
    const lower = placed.find((p) => p.type === "lower_achilles")!;
    // Not Tue (d1), not Mon (day before interval), not Sat (d5), not Fri (before long).
    expect(["d1", "d0", "d5", "d4"]).not.toContain(lower.key);
  });

  it("skips a heavy slot entirely rather than break a hard rule", () => {
    // Only availability is the interval day itself.
    const days = week({ 2: "interval" });
    const placed = placeStrengthWeek(days, [3], ["lower"]); // dow 3 = Wed = d2
    expect(placed).toHaveLength(0);
  });

  it("prefers rest days and avoids back-to-back strength", () => {
    const days = week({ 0: "easy", 3: "easy" }); // Mon + Thu easy runs
    const placed = placeStrengthWeek(days, ALL_DAYS, ["lower", "upper"]);
    expect(placed).toHaveLength(2);
    const keys = placed.map((p) => Number(p.key.slice(1))).sort((a, b) => a - b);
    expect(keys[1] - keys[0]).toBeGreaterThan(1); // never adjacent
  });

  it("lighter work can share an easy-run day when days are scarce", () => {
    const days = week({ 0: "easy", 1: "easy", 2: "easy", 3: "easy", 4: "easy", 5: "easy", 6: "easy" });
    const placed = placeStrengthWeek(days, ALL_DAYS, ["upper"]);
    expect(placed).toHaveLength(1); // -8 doubling penalty is not a veto
  });

  it("respects already-taken days", () => {
    const days = week({}, [2]);
    const placed = placeStrengthWeek(days, [3], ["upper"]); // only Wed available, taken
    expect(placed).toHaveLength(0);
  });
});

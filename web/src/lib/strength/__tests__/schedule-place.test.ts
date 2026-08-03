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

  it("keeps same-muscle-group strength days apart", () => {
    // Two lower sessions in one week — same muscle group, so back-to-back
    // must still be avoided even though nothing else conflicts.
    const days = week({});
    const placed = placeStrengthWeek(days, ALL_DAYS, ["lower", "lower_achilles"]);
    expect(placed).toHaveLength(2);
    const keys = placed.map((p) => Number(p.key.slice(1))).sort((a, b) => a - b);
    expect(keys[1] - keys[0]).toBeGreaterThan(1); // never adjacent
  });

  it("allows an upper/lower split on consecutive days — different muscle groups, no conflict", () => {
    // A rest-day-only week: nothing else should push these apart, so the
    // engine is free to place them back-to-back the way an upper/lower (or
    // push-pull-legs) split routinely does.
    const days = week({});
    const placed = placeStrengthWeek(days, ALL_DAYS, ["lower", "upper"]);
    expect(placed).toHaveLength(2);
    const keys = placed.map((p) => Number(p.key.slice(1))).sort((a, b) => a - b);
    expect(keys[1] - keys[0]).toBe(1); // adjacent, and that's fine
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

  it("never places any session type on race day or the day before it", () => {
    // Sat (d5) is race day. Even a light "upper" session must avoid Fri (d4)
    // and Sat (d5) — this is a hard veto, not just a heavy-legs preference.
    const days = week({ 5: "race" });
    const placed = placeStrengthWeek(days, ALL_DAYS, ["upper"]);
    for (const p of placed) {
      expect(["d4", "d5"]).not.toContain(p.key);
    }
  });

  it("skips the slot entirely rather than place it near race day when nothing else is available", () => {
    const days = week({ 3: "race" }); // Thu (d3, dow 4) is race day
    const placed = placeStrengthWeek(days, [3, 4], ["upper"]); // only Wed (d2) and Thu (d3) available
    expect(placed).toHaveLength(0);
  });

  it("places all 4 sessions in a Mon-Fri week with no same-group session on consecutive days (regression)", () => {
    // Mon-Thu easy runs, Fri rest, Sat long, Sun rest — weekday-only
    // availability, the exact production shape that used to lose the 4th
    // session. The all_round[4] rotation alternates lower/upper (see
    // reconcile.ts ROTATIONS) precisely so a flat "no back-to-back" rule
    // never has to fight the pigeonhole problem: group-aware spacing lets
    // upper and lower interleave cleanly across 5 weekday slots.
    const days = week({ 0: "easy", 1: "easy", 2: "easy", 3: "easy", 5: "long" });
    const availableDows = [1, 2, 3, 4, 5]; // Mon-Fri
    const placed = placeStrengthWeek(days, availableDows, ["lower", "upper", "lower", "upper"]);
    expect(placed).toHaveLength(4);

    const LOWER = new Set(["lower", "lower_achilles"]);
    const sorted = [...placed].sort((a, b) => Number(a.key.slice(1)) - Number(b.key.slice(1)));
    for (let i = 1; i < sorted.length; i++) {
      const prevIdx = Number(sorted[i - 1].key.slice(1));
      const curIdx = Number(sorted[i].key.slice(1));
      if (curIdx - prevIdx !== 1) continue; // not calendar-adjacent, nothing to check
      const sameGroup = LOWER.has(sorted[i - 1].type) === LOWER.has(sorted[i].type);
      expect(sameGroup).toBe(false);
    }
  });

  it("still shows the real shortfall when the athlete genuinely can't fit the target", () => {
    // Only 2 available days for 4 sessions — no amount of spacing logic can
    // conjure two more days; this must legitimately come back short.
    const days = week({ 0: "easy", 3: "easy" });
    const placed = placeStrengthWeek(days, [1, 4], ["lower", "upper", "lower", "upper"]); // Mon + Thu only
    expect(placed.length).toBeLessThan(4);
  });

  describe("achilles complaint — every session type carries the same calf/tendon load", () => {
    // program.ts sessionTemplateFor appends the explosive/HSR calf block to
    // EVERY session type (unconditionally, unlike every other complaint) when
    // "achilles" is reported. Muscle groups here are derived from that
    // resolved template, not the bare type label — so for this athlete,
    // "upper" and "lower" no longer look unrelated; both load the healing
    // tendon, and the spacing rule must catch that.

    it("no longer lets upper/lower go back-to-back once the achilles complaint is passed in", () => {
      const days = week({});
      const placed = placeStrengthWeek(days, ALL_DAYS, ["lower", "upper"], ["achilles"]);
      expect(placed).toHaveLength(2);
      const keys = placed.map((p) => Number(p.key.slice(1))).sort((a, b) => a - b);
      expect(keys[1] - keys[0]).toBeGreaterThan(1); // now avoided, unlike the no-complaint case above
    });

    it("still places every session — spacing is a preference, not a veto, even under the complaint", () => {
      // Same tight Mon-Fri shape as the regression above; with every session
      // now sharing a group, spacing can only choose *which* days, never
      // drop one, so all 4 must still come back.
      const days = week({ 0: "easy", 1: "easy", 2: "easy", 3: "easy", 5: "long" });
      const availableDows = [1, 2, 3, 4, 5];
      const placed = placeStrengthWeek(
        days,
        availableDows,
        ["lower", "upper", "lower", "upper"],
        ["achilles"]
      );
      expect(placed).toHaveLength(4);
    });

    it("day-before-a-hard-run stays a hard veto for every type, not just lower, once achilles is reported", () => {
      // Tue is an interval day; Mon (the day before) must be off-limits for
      // "upper" too now, since it also carries the HSR calf block.
      const days = week({ 1: "interval" });
      const placed = placeStrengthWeek(days, ALL_DAYS, ["upper"], ["achilles"]);
      for (const p of placed) {
        expect(p.key).not.toBe("d0"); // Monday, the day before the Tuesday interval
      }
    });
  });
});

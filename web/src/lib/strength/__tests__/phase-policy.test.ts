import { describe, expect, it } from "vitest";
import { setsDeltaFor, phaseSummaryFor, repRangeFor } from "../phase-policy";

describe("setsDeltaFor", () => {
  it("no active running plan leaves sets untouched (standalone block)", () => {
    expect(setsDeltaFor(null)).toBe(0);
    expect(setsDeltaFor(undefined)).toBe(0);
  });

  it("base and build are normal load", () => {
    expect(setsDeltaFor({ phase: "base", type: "normal" })).toBe(0);
    expect(setsDeltaFor({ phase: "build", type: "normal" })).toBe(0);
  });

  it("peak backs off less than taper — running is the priority, not shut down", () => {
    const peak = setsDeltaFor({ phase: "peak", type: "normal" });
    const taper = setsDeltaFor({ phase: "taper", type: "normal" });
    expect(peak).toBeLessThan(0);
    expect(taper).toBeLessThan(peak); // taper backs off further than peak
  });

  it("a deload week deloads strength regardless of phase", () => {
    expect(setsDeltaFor({ phase: "build", type: "deload" })).toBe(setsDeltaFor({ phase: "peak", type: "deload" }));
    expect(setsDeltaFor({ phase: "build", type: "deload" })).toBeLessThan(0);
  });

  it("race week is the most conservative of all", () => {
    const race = setsDeltaFor({ phase: "taper", type: "race" });
    const taper = setsDeltaFor({ phase: "taper", type: "normal" });
    expect(race).toBeLessThan(taper);
  });
});

describe("phaseSummaryFor", () => {
  it("no active running plan reports nothing (standalone block)", () => {
    expect(phaseSummaryFor(null)).toBeNull();
    expect(phaseSummaryFor(undefined)).toBeNull();
  });

  it("reports the phase the engine actually used, not the type override", () => {
    const summary = phaseSummaryFor({ phase: "peak", type: "deload" });
    expect(summary?.phase).toBe("peak");
    expect(summary?.phaseLabel).toBe("Peak");
  });

  it("a deload week's note explains the override regardless of phase", () => {
    const build = phaseSummaryFor({ phase: "build", type: "deload" });
    const peak = phaseSummaryFor({ phase: "peak", type: "deload" });
    expect(build?.note).toBe(peak?.note);
    expect(build?.note).toMatch(/deload/i);
  });

  it("race week's note is distinct from a normal taper week's", () => {
    const race = phaseSummaryFor({ phase: "taper", type: "race" });
    const taper = phaseSummaryFor({ phase: "taper", type: "normal" });
    expect(race?.note).not.toBe(taper?.note);
  });

  it("normal weeks use the phase's own note from PHASE_SET_POLICY", () => {
    const build = phaseSummaryFor({ phase: "build", type: "normal" });
    expect(build?.note).toBe("Normal load — this is the phase that does the work.");
  });
});

describe("repRangeFor", () => {
  it("no active running plan leaves the range unresolved (standalone block)", () => {
    expect(repRangeFor(null)).toBeNull();
    expect(repRangeFor(undefined)).toBeNull();
  });

  it("base keeps the standard hypertrophy range", () => {
    expect(repRangeFor({ phase: "base", type: "normal" })).toEqual({ repLow: 8, repHigh: 12 });
  });

  it("build compresses to a maximal-strength range", () => {
    expect(repRangeFor({ phase: "build", type: "normal" })).toEqual({ repLow: 4, repHigh: 6 });
  });

  it("peak and taper keep build's range rather than reverting toward base", () => {
    const build = repRangeFor({ phase: "build", type: "normal" });
    const peak = repRangeFor({ phase: "peak", type: "normal" });
    const taper = repRangeFor({ phase: "taper", type: "normal" });
    expect(peak).toEqual(build);
    expect(taper).toEqual(build);
  });

  it("unlike setsDeltaFor, a deload/race week does NOT override the range — it keeps whatever phase it sits inside", () => {
    const normal = repRangeFor({ phase: "build", type: "normal" });
    const deload = repRangeFor({ phase: "build", type: "deload" });
    const race = repRangeFor({ phase: "build", type: "race" });
    expect(deload).toEqual(normal);
    expect(race).toEqual(normal);
  });
});

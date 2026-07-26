import { describe, expect, it } from "vitest";
import { setsDeltaFor } from "../phase-policy";

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

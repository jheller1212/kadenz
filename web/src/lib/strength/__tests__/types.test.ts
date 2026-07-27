import { describe, expect, it } from "vitest";
import { workingSetNumber } from "../types";

describe("workingSetNumber", () => {
  it("numbers sets 1, 2, 3… when there is no warm-up ramp", () => {
    const sets = [{ kind: "working" as const }, { kind: "working" as const }, { kind: "working" as const }];
    expect(sets.map((_, i) => workingSetNumber(sets, i))).toEqual([1, 2, 3]);
  });

  it("does not let a warm-up ramp shift the working-set numbering", () => {
    // Two warm-ups ahead of three working sets — matches the guided logger's
    // ramp layout (see GuidedSession.tsx buildWork).
    const sets = [
      { kind: "warmup" as const },
      { kind: "warmup" as const },
      { kind: "working" as const },
      { kind: "working" as const },
      { kind: "working" as const },
    ];
    // The athlete logs the first real set as "Set 1", not "Set 3".
    expect(sets.map((_, i) => workingSetNumber(sets, i))).toEqual([0, 0, 1, 2, 3]);
  });

  it("treats a null/missing kind (pre-warm-up-feature rows) as working", () => {
    const sets = [{ kind: null }, { kind: undefined }, {}];
    expect(sets.map((_, i) => workingSetNumber(sets, i))).toEqual([1, 2, 3]);
  });

  it("still numbers correctly when a warm-up is toggled in mid-array (not just at the front)", () => {
    const sets = [
      { kind: "working" as const },
      { kind: "warmup" as const },
      { kind: "working" as const },
    ];
    expect(sets.map((_, i) => workingSetNumber(sets, i))).toEqual([1, 1, 2]);
  });
});

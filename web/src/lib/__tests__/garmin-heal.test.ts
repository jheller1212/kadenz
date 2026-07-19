import { describe, expect, it } from "vitest";
import { ourOrphanIds, rowsNeedingRepush } from "../sync/garmin-heal";

describe("rowsNeedingRepush", () => {
  it("flags rows whose Garmin workout no longer exists", () => {
    const rows = [
      { id: "a", garminWorkoutId: "1" },
      { id: "b", garminWorkoutId: "2" },
      { id: "c", garminWorkoutId: null },
    ];
    expect(rowsNeedingRepush(rows, new Set(["1"]))).toEqual(["b"]);
  });

  it("leaves never-pushed rows alone", () => {
    const rows = [{ id: "a", garminWorkoutId: null }];
    expect(rowsNeedingRepush(rows, new Set())).toEqual([]);
  });

  it("returns nothing when everything is present", () => {
    const rows = [{ id: "a", garminWorkoutId: "1" }];
    expect(rowsNeedingRepush(rows, new Set(["1"]))).toEqual([]);
  });
});

describe("ourOrphanIds", () => {
  it("never returns a workout another app created", () => {
    const onGarmin = [
      { garminWorkoutId: "1", createdByKadenz: false }, // Benchmark's
      { garminWorkoutId: "2", createdByKadenz: true },  // ours, unreferenced
      { garminWorkoutId: "3", createdByKadenz: true },  // ours, still tracked
    ];
    expect(ourOrphanIds(onGarmin, new Set(["3"]))).toEqual(["2"]);
  });

  it("returns nothing when we own nothing on the account", () => {
    const onGarmin = [
      { garminWorkoutId: "1", createdByKadenz: false },
      { garminWorkoutId: "2", createdByKadenz: false },
    ];
    expect(ourOrphanIds(onGarmin, new Set())).toEqual([]);
  });
});

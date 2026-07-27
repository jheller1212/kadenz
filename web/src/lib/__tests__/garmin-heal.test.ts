import { describe, expect, it } from "vitest";
import { isListingPossiblyPartial, ourOrphanIds, rowsNeedingRepush } from "../sync/garmin-heal";

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
      { garminWorkoutId: "1", createdByKadenz: false }, // another app's
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

  it("never flags a tracked id even when it is the only item on the account", () => {
    // Guards the "active plan wiped out by a bad read" failure mode: a
    // tracked id must survive being the sole entry on Garmin.
    const onGarmin = [{ garminWorkoutId: "active-plan-workout", createdByKadenz: true }];
    expect(ourOrphanIds(onGarmin, new Set(["active-plan-workout"]))).toEqual([]);
  });
});

describe("isListingPossiblyPartial", () => {
  it("flags a listing that came back exactly at the cap", () => {
    expect(isListingPossiblyPartial(500, 500)).toBe(true);
  });

  it("flags a listing that somehow exceeds the cap", () => {
    expect(isListingPossiblyPartial(501, 500)).toBe(true);
  });

  it("does not flag a listing under the cap", () => {
    expect(isListingPossiblyPartial(499, 500)).toBe(false);
  });

  it("does not flag an empty account", () => {
    expect(isListingPossiblyPartial(0, 500)).toBe(false);
  });
});

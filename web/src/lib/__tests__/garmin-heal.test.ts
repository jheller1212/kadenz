import { describe, expect, it } from "vitest";
import {
  findAdoptionCandidate,
  isListingPossiblyPartial,
  ourOrphanIds,
  rowsNeedingRepush,
  type AdoptionCandidate,
} from "../sync/garmin-heal";

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

describe("findAdoptionCandidate", () => {
  // The bug this closes: Garmin's create call succeeds but the id write back
  // onto our row fails, so the row still reads "never pushed" and the retry
  // (or the daily window sync) tries to create the same workout a second
  // time. This is the check that runs before that second create.

  it("adopts an exact title + scheduled-date match that is ours and unclaimed", () => {
    const listing: AdoptionCandidate[] = [
      {
        garminWorkoutId: "111",
        name: "W3 · Easy Run 10km",
        createdByKadenz: true,
        scheduledDates: ["2026-08-03"],
      },
    ];
    expect(
      findAdoptionCandidate(listing, new Set(), "W3 · Easy Run 10km", "2026-08-03")
    ).toBe("111");
  });

  it("does not adopt a matching workout another row already tracks", () => {
    const listing: AdoptionCandidate[] = [
      {
        garminWorkoutId: "111",
        name: "W3 · Easy Run 10km",
        createdByKadenz: true,
        scheduledDates: ["2026-08-03"],
      },
    ];
    expect(
      findAdoptionCandidate(
        listing,
        new Set(["111"]),
        "W3 · Easy Run 10km",
        "2026-08-03"
      )
    ).toBeNull();
  });

  it("never adopts a workout Kadenz did not create", () => {
    const listing: AdoptionCandidate[] = [
      {
        garminWorkoutId: "111",
        name: "W3 · Easy Run 10km",
        createdByKadenz: false,
        scheduledDates: ["2026-08-03"],
      },
    ];
    expect(
      findAdoptionCandidate(listing, new Set(), "W3 · Easy Run 10km", "2026-08-03")
    ).toBeNull();
  });

  it("does not adopt the same title scheduled on a different date", () => {
    const listing: AdoptionCandidate[] = [
      {
        garminWorkoutId: "111",
        name: "W3 · Easy Run 10km",
        createdByKadenz: true,
        scheduledDates: ["2026-08-04"],
      },
    ];
    expect(
      findAdoptionCandidate(listing, new Set(), "W3 · Easy Run 10km", "2026-08-03")
    ).toBeNull();
  });

  it("creates (returns null) against an empty listing", () => {
    expect(
      findAdoptionCandidate([], new Set(), "W3 · Easy Run 10km", "2026-08-03")
    ).toBeNull();
  });
});

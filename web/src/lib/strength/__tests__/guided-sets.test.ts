import { describe, expect, it } from "vitest";
import { appendExtraSet, removeLastExtraSet } from "../guided-sets";
import { sessionVolume } from "../volume";
import { suggestProgression } from "../progression";
import type { GuidedWorkSet } from "../guided-snapshot";
import type { ExerciseDef, ExerciseSessionHistory } from "../types";

function workingSet(kg: number, reps: number, logged = true): GuidedWorkSet {
  return { kg, reps, logged, durationSec: 30, kind: "working" };
}

describe("appendExtraSet", () => {
  it("appends at the end, prefilled from the previous set in the array", () => {
    const arr = [workingSet(20, 10), workingSet(22, 9), workingSet(22, 8)];
    const next = appendExtraSet(arr, { kg: 0, reps: 0 });
    expect(next).toHaveLength(4);
    expect(next[3]).toMatchObject({ kg: 22, reps: 8, logged: false, kind: "working", extra: true });
    // Original array is untouched (pure).
    expect(arr).toHaveLength(3);
  });

  it("falls back to the exercise default when the exercise has no sets yet", () => {
    const next = appendExtraSet([], { kg: 12.5, reps: 10 });
    expect(next[0]).toMatchObject({ kg: 12.5, reps: 10, extra: true });
  });

  it("setNumber allocation (array position + 1) never collides with an earlier logged row", () => {
    // Three prescribed sets already logged (setNumbers 1-3) plus one extra
    // logged (setNumber 4) — appending again must land on setNumber 5, not
    // re-use 1-4.
    let arr = [workingSet(20, 10), workingSet(20, 10), workingSet(20, 10)];
    arr = appendExtraSet(arr, { kg: 0, reps: 0 });
    const firstExtraSetNumber = arr.length; // setIndex + 1, same as GuidedSession's postSet
    expect(firstExtraSetNumber).toBe(4);
    arr = appendExtraSet(arr, { kg: 0, reps: 0 });
    const secondExtraSetNumber = arr.length;
    expect(secondExtraSetNumber).toBe(5);
  });
});

describe("removeLastExtraSet", () => {
  it("removes only the last set, and only when it's flagged extra", () => {
    const arr = [workingSet(20, 10), { ...workingSet(22, 8), extra: true }];
    const { next, removedIndex, wasLogged } = removeLastExtraSet(arr);
    expect(next).toHaveLength(1);
    expect(removedIndex).toBe(1);
    expect(wasLogged).toBe(true);
  });

  it("refuses to remove a prescribed (non-extra) set even if it's last", () => {
    const arr = [workingSet(20, 10), workingSet(22, 8)];
    const { next, removedIndex } = removeLastExtraSet(arr);
    expect(removedIndex).toBeNull();
    expect(next).toBe(arr);
  });

  it("appending after a removal reuses the freed setNumber, not a new one beyond it", () => {
    let arr = [workingSet(20, 10), workingSet(20, 10), workingSet(20, 10)];
    arr = appendExtraSet(arr, { kg: 0, reps: 0 }); // setNumber 4, extra
    const { next } = removeLastExtraSet(arr);
    arr = next;
    expect(arr).toHaveLength(3);
    arr = appendExtraSet(arr, { kg: 0, reps: 0 });
    // Freed slot re-used: the new extra set is setNumber 4 again, not 5 —
    // safe because the earlier setNumber-4 row was actually deleted
    // server-side (see GuidedSession's removeLastSet DELETE call), so the
    // upsert on that key is a genuine re-create, not an overwrite of live data.
    expect(arr.length).toBe(4);
  });
});

describe("extra sets count as real work", () => {
  it("volume includes a logged extra working set", () => {
    const base = sessionVolume([
      { exerciseSlug: "overhead_press", weightKg: 10, reps: 10, kind: "working" },
      { exerciseSlug: "overhead_press", weightKg: 10, reps: 10, kind: "working" },
    ]);
    const withExtra = sessionVolume([
      { exerciseSlug: "overhead_press", weightKg: 10, reps: 10, kind: "working" },
      { exerciseSlug: "overhead_press", weightKg: 10, reps: 10, kind: "working" },
      { exerciseSlug: "overhead_press", weightKg: 10, reps: 10, kind: "working" }, // the extra set
    ]);
    expect(withExtra.kg).toBe((base.kg ?? 0) + 200); // one more set: 10kg x2 hands x10 reps
  });

  it("volume excludes an extra set logged as a warm-up (kind still gates it, not the extra flag)", () => {
    const v = sessionVolume([
      { exerciseSlug: "overhead_press", weightKg: 10, reps: 10, kind: "working" },
      { exerciseSlug: "overhead_press", weightKg: 5, reps: 10, kind: "warmup" },
    ]);
    expect(v.kg).toBe(200);
  });

  it("progression's allSetsAtTop sees an extra top-of-range set and still suggests an increase", () => {
    const squat: ExerciseDef = {
      slug: "db_squat",
      name: "Dumbbell squat",
      category: "lower",
      repLow: 8,
      repHigh: 12,
      startWeightKg: 12.5,
    };
    const withExtraAtTop: ExerciseSessionHistory = {
      sessionId: "s1",
      date: new Date("2026-07-20"),
      sets: [
        { setNumber: 1, reps: 12, weightKg: 12.5 },
        { setNumber: 2, reps: 12, weightKg: 12.5 },
        { setNumber: 3, reps: 12, weightKg: 12.5 },
        { setNumber: 4, reps: 12, weightKg: 12.5 }, // the extra set, also at the top
      ],
    };
    const s = suggestProgression(squat, [withExtraAtTop]);
    expect(s.action).toBe("increase");
  });

  it("progression's anySetBelowFloor is still tripped by an extra set that came up short", () => {
    const squat: ExerciseDef = {
      slug: "db_squat",
      name: "Dumbbell squat",
      category: "lower",
      repLow: 8,
      repHigh: 12,
      startWeightKg: 12.5,
    };
    const last: ExerciseSessionHistory = {
      sessionId: "s1",
      date: new Date("2026-07-20"),
      sets: [
        { setNumber: 1, reps: 12, weightKg: 12.5 },
        { setNumber: 2, reps: 12, weightKg: 12.5 },
        { setNumber: 3, reps: 12, weightKg: 12.5 },
        { setNumber: 4, reps: 6, weightKg: 12.5 }, // an extra 4th set that fell short
      ],
    };
    const prev: ExerciseSessionHistory = {
      sessionId: "s0",
      date: new Date("2026-07-13"),
      sets: [
        { setNumber: 1, reps: 7, weightKg: 12.5 },
      ],
    };
    const s = suggestProgression(squat, [last, prev]);
    expect(s.action).toBe("decrease");
  });
});

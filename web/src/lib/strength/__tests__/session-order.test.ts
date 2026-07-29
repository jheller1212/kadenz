import { describe, expect, it } from "vitest";
import { firstLoggedExerciseOrder } from "../session-order";

describe("firstLoggedExerciseOrder", () => {
  it("orders exercises by when they were first logged, not template/insertion order", () => {
    // Template order would be squat, bench, clamshell — the athlete actually
    // did clamshell last.
    const order = firstLoggedExerciseOrder([
      { exerciseId: "squat", createdAt: "2026-07-27T10:00:00Z" },
      { exerciseId: "bench", createdAt: "2026-07-27T10:05:00Z" },
      { exerciseId: "squat", createdAt: "2026-07-27T10:01:00Z" },
      { exerciseId: "clamshell", createdAt: "2026-07-27T10:10:00Z" },
      { exerciseId: "bench", createdAt: "2026-07-27T10:06:00Z" },
    ]);
    expect(order).toEqual(["squat", "bench", "clamshell"]);
  });

  it("an exercise with no logged sets simply never appears", () => {
    const order = firstLoggedExerciseOrder([
      { exerciseId: "squat", createdAt: "2026-07-27T10:00:00Z" },
    ]);
    expect(order).toEqual(["squat"]);
  });

  it("returns an empty order for no sets at all", () => {
    expect(firstLoggedExerciseOrder([])).toEqual([]);
  });

  it("two exercises whose first sets share a timestamp keep input order deterministically", () => {
    const order = firstLoggedExerciseOrder([
      { exerciseId: "bench", createdAt: "2026-07-27T10:00:00Z" },
      { exerciseId: "squat", createdAt: "2026-07-27T10:00:00Z" },
    ]);
    expect(order).toEqual(["bench", "squat"]);

    // Same tie, opposite input order — the result follows, it isn't fixed
    // alphabetically or by any other hidden key.
    const reversed = firstLoggedExerciseOrder([
      { exerciseId: "squat", createdAt: "2026-07-27T10:00:00Z" },
      { exerciseId: "bench", createdAt: "2026-07-27T10:00:00Z" },
    ]);
    expect(reversed).toEqual(["squat", "bench"]);
  });

  it("a bonus set appended later to an earlier exercise doesn't reorder the list", () => {
    // Exercise 1 done first, exercise 3 done second, then a bonus set of
    // exercise 1 logged after exercise 3 was already finished — first-logged
    // is the key, not last-logged, so exercise1 must stay first.
    const order = firstLoggedExerciseOrder([
      { exerciseId: "ex1", createdAt: "2026-07-27T10:00:00Z" },
      { exerciseId: "ex1", createdAt: "2026-07-27T10:01:00Z" },
      { exerciseId: "ex3", createdAt: "2026-07-27T10:05:00Z" },
      // Bonus set of ex1, logged after ex3's sets.
      { exerciseId: "ex1", createdAt: "2026-07-27T10:10:00Z" },
    ]);
    expect(order).toEqual(["ex1", "ex3"]);
  });
});

import { describe, expect, it } from "vitest";
import { pickWorkoutMatch, type WorkoutMatchCandidate } from "../workout-match";

// ── Cross-source dedup: which workout counts as "already linked" ────────────
// The bug this covers: a workout completed by a Garmin import (status +
// actualKm only, no stravaActivityId) must still be excluded from matching
// once a Strava upload of the same run arrives later — otherwise the same
// physical run links twice and the second import overwrites actualKm.

describe("pickWorkoutMatch", () => {
  const planned: WorkoutMatchCandidate = { id: "w-planned", status: "planned", targetKm: 10 };
  const completedNoLink: WorkoutMatchCandidate = {
    id: "w-completed",
    status: "completed",
    targetKm: 10,
  };

  it("excludes a workout already linked to a recorded activity, regardless of source", () => {
    // w-completed was completed by a Garmin import — no stravaActivityId was
    // ever set, but it now has a row in `activities` pointing at it.
    const result = pickWorkoutMatch([completedNoLink], new Set(["w-completed"]), 10);
    expect(result).toBeNull();
  });

  it("still matches an open planned workout when a linked one shares the day", () => {
    const result = pickWorkoutMatch(
      [completedNoLink, planned],
      new Set(["w-completed"]),
      10
    );
    expect(result).toBe("w-planned");
  });

  it("prefers planned over manually-completed-but-unlinked workouts", () => {
    const manuallyCompleted: WorkoutMatchCandidate = {
      id: "w-manual",
      status: "completed",
      targetKm: 10,
    };
    const result = pickWorkoutMatch([manuallyCompleted, planned], new Set(), 10);
    expect(result).toBe("w-planned");
  });

  it("breaks ties on targetKm closest to the actual distance", () => {
    const short: WorkoutMatchCandidate = { id: "w-short", status: "planned", targetKm: 5 };
    const long: WorkoutMatchCandidate = { id: "w-long", status: "planned", targetKm: 15 };
    expect(pickWorkoutMatch([short, long], new Set(), 14)).toBe("w-long");
    expect(pickWorkoutMatch([short, long], new Set(), 6)).toBe("w-short");
  });

  it("returns null when every same-day candidate is already linked", () => {
    const result = pickWorkoutMatch([completedNoLink], new Set(["w-completed"]), 10);
    expect(result).toBeNull();
  });

  it("returns null with no candidates", () => {
    expect(pickWorkoutMatch([], new Set(), 10)).toBeNull();
  });
});

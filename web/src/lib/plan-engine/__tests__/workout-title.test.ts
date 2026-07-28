import { describe, expect, it } from "vitest";
import { displayWorkoutTitle } from "../workout-title";

describe("displayWorkoutTitle", () => {
  it("shows the km title for a km athlete", () => {
    const title = displayWorkoutTitle(
      { type: "easy", title: "Easy Run 8km", targetKm: 8 },
      "km"
    );
    expect(title).toBe("Easy Run 8 km");
  });

  it("shows a miles title for a miles athlete, not the stored km string", () => {
    const title = displayWorkoutTitle(
      { type: "easy", title: "Easy Run 8km", targetKm: 8 },
      "miles"
    );
    expect(title).toBe("Easy Run 5 mi");
    expect(title).not.toContain("km");
  });

  it("converts the long run title too", () => {
    const title = displayWorkoutTitle(
      { type: "long", title: "Long Run 16km", targetKm: 16 },
      "miles"
    );
    expect(title).toBe("Long Run 9.9 mi");
  });

  it("derives the tempo title from the work block, not the padded total", () => {
    const title = displayWorkoutTitle(
      {
        type: "tempo",
        title: "Tempo Run 5km",
        targetKm: 7.5, // warmup + work + cooldown
        blocks: [
          { type: "warmup", distanceKm: 1.5 },
          { type: "work", distanceKm: 5 },
          { type: "cooldown", distanceKm: 1 },
        ],
      },
      "km"
    );
    expect(title).toBe("Tempo Run 5 km");
  });

  it("falls back to the stored title when blocks are missing (tempo)", () => {
    const title = displayWorkoutTitle(
      { type: "tempo", title: "Tempo Run 5km", targetKm: 7.5 },
      "miles"
    );
    expect(title).toBe("Tempo Run 5km");
  });

  it("leaves interval titles alone — meters is a unit-independent convention", () => {
    const title = displayWorkoutTitle(
      { type: "interval", title: "Intervals 6x400m", targetKm: 4.5 },
      "miles"
    );
    expect(title).toBe("Intervals 6x400m");
  });

  it("leaves race and rest titles alone", () => {
    expect(
      displayWorkoutTitle({ type: "race", title: "Race Day · 10K" }, "miles")
    ).toBe("Race Day · 10K");
    expect(
      displayWorkoutTitle({ type: "rest", title: "Rest Day" }, "miles")
    ).toBe("Rest Day");
  });
});

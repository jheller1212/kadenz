import { describe, expect, it } from "vitest";
import { hasAchillesOrdering } from "../complaint-work";

// The ordering banner in GuidedSession used to be gated on the historic
// `lower_achilles` session type, which is no longer scheduled — Achilles work
// now arrives as extra slots in ordinary sessions. Gate on the exercises.
describe("hasAchillesOrdering", () => {
  it("is true when the session holds both an explosive and a slow heavy exercise", () => {
    expect(
      hasAchillesOrdering(["goblet_squat", "explosive_box_step_up", "straight_knee_calf_raise"])
    ).toBe(true);
  });

  it("is true regardless of the order they appear in", () => {
    expect(hasAchillesOrdering(["bent_knee_calf_raise", "loaded_toe_walk"])).toBe(true);
  });

  it("is false with only one half of the rule", () => {
    expect(hasAchillesOrdering(["goblet_squat", "explosive_box_step_up"])).toBe(false);
    expect(hasAchillesOrdering(["goblet_squat", "straight_knee_calf_raise"])).toBe(false);
  });

  it("is false for a session with no Achilles work", () => {
    expect(hasAchillesOrdering(["goblet_squat", "one_arm_row"])).toBe(false);
  });

  it("ignores slugs that are not in the catalogue", () => {
    expect(hasAchillesOrdering(["not_an_exercise", ""])).toBe(false);
  });
});

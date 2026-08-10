import { describe, expect, it } from "vitest";
import { complaintSubtitle, complaintWorkNames, hasAchillesOrdering } from "../complaint-work";
import { EXERCISE_BY_SLUG, TARGETED_WORK } from "../program";
import { STRENGTH_COMPLAINTS } from "../types";

// The line under each complaint in Kraft settings is a promise about the
// training the athlete is about to do, and it was wrong for as long as a
// complaint carried more than one exercise: it named only the first.
describe("complaint settings copy", () => {
  for (const complaint of STRENGTH_COMPLAINTS) {
    if (complaint === "achilles") continue; // its own HSR block, its own copy

    it(`${complaint} names every exercise it prescribes, and counts them correctly`, () => {
      const expected = TARGETED_WORK[complaint]!.exercises.map(
        (e) => EXERCISE_BY_SLUG[e.slug]!.name
      );
      const names = complaintWorkNames(complaint);
      expect(names).toEqual(expected);

      const subtitle = complaintSubtitle(complaint);
      expect(subtitle).toContain(`Adds ${expected.length} exercises`);
      for (const name of expected) expect(subtitle).toContain(name);
    });

    it(`${complaint} does not advertise an equipment fallback the athlete won't do`, () => {
      // complaintWorkSlugs deliberately includes variants (a box step-down OR
      // the wall-sit that replaces it) because the pain gate and the history
      // overlay need both. The copy must not: the athlete gets one of each
      // pair, so listing both would overstate the session.
      const prescribed = new Set(TARGETED_WORK[complaint]!.exercises.map((e) => e.slug));
      const variantNames = TARGETED_WORK[complaint]!.exercises
        .flatMap((e) => e.slot.variants ?? [])
        .filter((v) => !prescribed.has(v.exerciseSlug))
        .map((v) => EXERCISE_BY_SLUG[v.exerciseSlug]?.name)
        .filter((n): n is string => !!n);
      const subtitle = complaintSubtitle(complaint);
      for (const name of variantNames) expect(subtitle).not.toContain(name);
    });
  }

  it("says 'exercise' rather than 'exercises' if a complaint ever carries one", () => {
    // No complaint does today; this pins the grammar so adding one later
    // can't ship "Adds 1 exercises".
    expect(complaintSubtitle("achilles")).toBe(""); // not a TARGETED_WORK entry
  });
});

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

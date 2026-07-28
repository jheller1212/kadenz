import { describe, expect, it } from "vitest";
import { filterExercises, matchesGroup } from "../exercise-search";
import { muscleGroupFor } from "../muscle-groups";
import { EXERCISES } from "../program";
import type { ExerciseDef } from "../types";

// Small fixture set covering the cases the real ~88-exercise catalogue
// exercises the ranking on: an exact/partial name match, an equipment-only
// match, a group reachable only via secondaryMuscles (Biceps/Triceps in the
// real data, mirrored here), and a raw muscle the grouping map doesn't know.
const FIXTURES: ExerciseDef[] = [
  { slug: "back-squat", name: "Back Squat", category: "lower", primaryMuscle: "Quads", equipment: ["barbell"] },
  { slug: "goblet-squat", name: "Goblet Squat", category: "lower", primaryMuscle: "Quads", equipment: ["dumbbell"] },
  { slug: "bench-press", name: "Bench Press", category: "lower", primaryMuscle: "Chest", equipment: ["barbell"] },
  { slug: "calf-raise", name: "Calf Raise", category: "lower", primaryMuscle: "Calves & Achilles" },
  { slug: "bicep-curl", name: "Biceps curl", category: "upper", primaryMuscle: "Biceps" },
  {
    // Mirrors curl_to_press in program.ts: primary Biceps, but also trains
    // triceps — should surface under a Triceps filter, just ranked behind
    // exercises where Triceps is the primary muscle.
    slug: "curl-to-press",
    name: "Curl to press",
    category: "upper",
    primaryMuscle: "Biceps",
    secondaryMuscles: ["Triceps", "Shoulders"],
  },
  {
    slug: "triceps-pushdown",
    name: "Triceps pushdown",
    category: "upper",
    primaryMuscle: "Triceps",
  },
  {
    slug: "shoulder-tap",
    name: "Shoulder tap",
    category: "upper",
    primaryMuscle: "Core",
    secondaryMuscles: ["Knee stability"], // "Knee stability" is not a muscle — deliberately unmapped
  },
];

describe("filterExercises", () => {
  it("matches on name, trimmed and case-folded", () => {
    const result = filterExercises(FIXTURES, { query: "  BACK squat  ", group: null });
    expect(result.map((e) => e.slug)).toEqual(["back-squat"]);
  });

  it("ranks a name match above a weaker equipment/muscle match", () => {
    // "dumbbell" matches goblet-squat by equipment only; nothing here has
    // "dumbbell" in its name until we add one, proving name wins.
    const withNamedMatch: ExerciseDef[] = [
      ...FIXTURES,
      { slug: "dumbbell-row", name: "Dumbbell Row", category: "upper", primaryMuscle: "Back", equipment: ["dumbbell"] },
    ];
    const result = filterExercises(withNamedMatch, { query: "dumbbell", group: null });
    expect(result[0].slug).toBe("dumbbell-row");
    expect(result).toContainEqual(expect.objectContaining({ slug: "goblet-squat" }));
  });

  it("returns every exercise mapped into a merged group, including 'Calves & Achilles'", () => {
    const result = filterExercises(FIXTURES, { query: "", group: "Calves and shins" });
    expect(result.map((e) => e.slug)).toEqual(["calf-raise"]);
  });

  it("a Biceps filter returns an exercise that only has Biceps as a secondary muscle", () => {
    // curl-to-press's primaryMuscle is Biceps too here (mirrors program.ts),
    // so use a fixture where the *only* route to the group is secondary.
    const secondaryOnly: ExerciseDef[] = [
      { slug: "farmers-carry", name: "Farmer's Carry", category: "upper", primaryMuscle: "Core", secondaryMuscles: ["Grip"] },
    ];
    const result = filterExercises(secondaryOnly, { query: "", group: "Biceps" });
    expect(result.map((e) => e.slug)).toEqual(["farmers-carry"]);
  });

  it("ranks a primary-muscle group match above a secondary-only group match", () => {
    // Triceps filter: triceps-pushdown is primary Triceps, curl-to-press is
    // only Triceps via secondaryMuscles — the primary match must come first.
    const result = filterExercises(FIXTURES, { query: "", group: "Triceps" });
    expect(result.map((e) => e.slug)).toEqual(["triceps-pushdown", "curl-to-press"]);
  });

  it("a reassigned former-'Arms' exercise (now primaryMuscle Biceps) appears under Biceps", () => {
    const result = filterExercises(FIXTURES, { query: "", group: "Biceps" });
    expect(result.map((e) => e.slug)).toEqual(expect.arrayContaining(["bicep-curl", "curl-to-press"]));
  });

  it("composes a search query with a group filter", () => {
    const result = filterExercises(FIXTURES, { query: "squat", group: "Quads" });
    expect(result.map((e) => e.slug).sort()).toEqual(["back-squat", "goblet-squat"]);
    // Bench Press matches neither the query nor the group.
    expect(result.map((e) => e.slug)).not.toContain("bench-press");
  });

  it("returns nothing when no exercise matches", () => {
    const result = filterExercises(FIXTURES, { query: "nonexistent-exercise-xyz", group: null });
    expect(result).toEqual([]);
  });

  it("an exercise is never absent from every group: a non-muscle secondary value ('Knee stability') doesn't strand it", () => {
    expect(muscleGroupFor("Knee stability")).toBe("Other");
    // shoulder-tap's primaryMuscle (Core) is a real, mapped group, so it's
    // still reachable there even though its secondary value is unmapped.
    expect(matchesGroup(FIXTURES[7], "Core")).toBe(true);
  });
});

describe("muscleGroupFor against the real catalogue", () => {
  it("maps every primaryMuscle value actually used in program.ts", () => {
    const unmapped = EXERCISES.filter((ex) => muscleGroupFor(ex.primaryMuscle) === "Other");
    expect(unmapped).toEqual([]);
  });

  it("no longer has any exercise with the retired 'Arms' primaryMuscle", () => {
    expect(EXERCISES.some((ex) => ex.primaryMuscle === "Arms")).toBe(false);
  });
});

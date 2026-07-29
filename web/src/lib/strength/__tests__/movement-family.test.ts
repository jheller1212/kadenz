import { describe, expect, it } from "vitest";
import { movementFamilySlugs } from "../program";

// Reproduces the reported bug: a per-session equipment override can resolve
// the same movement to a different slug session to session (e.g. squatting
// with a barbell one day, dumbbells the next), which used to fragment
// "last done" history across slugs an athlete considers the same exercise.
// movementFamilySlugs is the data-driven grouping the history route uses to
// find the true most-recent session across every equipment variant, while
// load prefill and PRs stay keyed by the exact slug (see service.ts and the
// history route's `sessions`/`points`/`records`, both untouched by this).
describe("movementFamilySlugs", () => {
  it("groups every squat equipment variant together", () => {
    const family = movementFamilySlugs("db_squat");
    expect(family).toEqual(
      expect.arrayContaining(["barbell_back_squat", "db_squat", "kettlebell_squat", "air_squat"])
    );
  });

  it("is symmetric: any member resolves to the same group", () => {
    const fromDb = new Set(movementFamilySlugs("db_squat"));
    const fromBarbell = new Set(movementFamilySlugs("barbell_back_squat"));
    const fromAir = new Set(movementFamilySlugs("air_squat"));
    expect(fromBarbell).toEqual(fromDb);
    expect(fromAir).toEqual(fromDb);
  });

  it("merges hinge and hip-thrust families through their shared bodyweight fallback", () => {
    // resolveSlotVariant's own comment notes the hinge and hip-thrust ladders
    // both bottom out at hip_raise — that's one physical exercise regardless
    // of which slot prescribed it, so the two ladders merge transitively.
    const family = movementFamilySlugs("romanian_deadlift");
    expect(family).toContain("hip_raise");
    expect(family).toContain("glute_bridge");
    expect(family).toContain("barbell_hip_thrust_with_bench");
  });

  it("never merges genuinely different movement patterns without a shared variant", () => {
    const squatFamily = movementFamilySlugs("db_squat");
    expect(squatFamily).not.toContain("overhead_press");
    expect(squatFamily).not.toContain("bent_over_row");
  });

  it("returns a singleton for a slug with no equipment-driven variants", () => {
    // Achilles-role and single-exercise accessory slots are never in a
    // variants list (see program.ts) — they must not be merged with anything.
    expect(movementFamilySlugs("curl_to_press")).toEqual(["curl_to_press"]);
  });
});

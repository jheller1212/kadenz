import { describe, it, expect } from "vitest";
import { cardCarriesRehabWork, pickerTypesFor } from "../picker";
import { buildSessionPlan } from "../session";

describe("pickerTypesFor", () => {
  it("offers the three standard programmes to an athlete with no complaints", () => {
    expect(pickerTypesFor([])).toEqual(["full_body", "upper", "lower"]);
  });

  it("adds Rehab once the athlete reports the Achilles complaint", () => {
    // The reason this card exists at all: before it, rehab work was reachable
    // only through the weekly rehab pass, so an athlete whose plan carried no
    // rehab day — for any reason — had no way to do the work.
    expect(pickerTypesFor(["achilles"])).toEqual([
      "full_body",
      "upper",
      "lower",
      "achilles",
    ]);
  });

  it("does not add Rehab for an unrelated complaint", () => {
    expect(pickerTypesFor(["hip_glute"])).not.toContain("achilles");
  });

  it("never offers the historic combo types", () => {
    // upper_achilles/lower_achilles exist only on sessions created before
    // #155 — reachable from history, never offered fresh.
    const offered = pickerTypesFor(["achilles", "hip_glute"]);
    expect(offered).not.toContain("upper_achilles");
    expect(offered).not.toContain("lower_achilles");
  });

  it("returns a fresh array on both paths, so no caller can mutate the shared base list", () => {
    pickerTypesFor(["achilles"]).pop();
    expect(pickerTypesFor(["achilles"])).toHaveLength(4);
    pickerTypesFor([]).pop();
    expect(pickerTypesFor([])).toHaveLength(3);
  });
});

describe("cardCarriesRehabWork", () => {
  it("says yes only when today's session actually carries the block", () => {
    expect(cardCarriesRehabWork("upper", { achillesAttached: true })).toBe(true);
    expect(cardCarriesRehabWork("upper", { achillesAttached: false })).toBe(false);
  });

  it("says no when there is no session yet, whatever the athlete reports", () => {
    // The regression this function exists for: the card used to promise
    // "+ Rehab work" here purely because the complaint was reported, so every
    // programme advertised rehab work that the created session never had.
    expect(cardCarriesRehabWork("upper", undefined)).toBe(false);
    expect(cardCarriesRehabWork("lower", undefined)).toBe(false);
    expect(cardCarriesRehabWork("full_body", undefined)).toBe(false);
  });

  it("never advertises rehab work on the Rehab card itself", () => {
    expect(cardCarriesRehabWork("achilles", undefined)).toBe(false);
    expect(cardCarriesRehabWork("achilles", { achillesAttached: true })).toBe(false);
  });

  // The claim above is only worth anything if it matches what the session
  // actually contains — so assert against the plan builder itself, not
  // against a second copy of the rule.
  it("matches what the session builder actually produces, for both answers", () => {
    const rehabSlugs = ["explosive_box_step_up", "straight_knee_calf_raise", "loaded_toe_walk"];
    const hasRehab = (attached: boolean) => {
      const plan = buildSessionPlan("upper", {
        complaints: ["achilles", "hip_glute"],
        achillesAttached: attached,
      });
      return rehabSlugs.every((s) => plan.some((p) => p.slug === s));
    };
    // Reporting the complaint does not, on its own, put the block in a
    // session — which is exactly what the old card copy claimed it did.
    expect(hasRehab(false)).toBe(false);
    expect(cardCarriesRehabWork("upper", { achillesAttached: false })).toBe(false);
    expect(hasRehab(true)).toBe(true);
    expect(cardCarriesRehabWork("upper", { achillesAttached: true })).toBe(true);
  });
});

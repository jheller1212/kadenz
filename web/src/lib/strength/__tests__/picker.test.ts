import { describe, it, expect } from "vitest";
import { pickerTypesFor } from "../picker";

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

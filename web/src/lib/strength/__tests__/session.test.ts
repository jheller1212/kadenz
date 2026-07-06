import { describe, expect, it } from "vitest";
import { buildSessionPlan, validateAchillesOrdering } from "../session";
import { SESSION_TEMPLATES } from "../program";

describe("buildSessionPlan", () => {
  it("places explosive Achilles work before slow-heavy HSR work", () => {
    const plan = buildSessionPlan("lower_achilles");
    const explosiveIdx = plan.findIndex((p) => p.slug === "explosive_box_step_up");
    const hsrIdx = plan.findIndex((p) => p.slug === "straight_knee_calf_raise");
    expect(explosiveIdx).toBeGreaterThanOrEqual(0);
    expect(hsrIdx).toBeGreaterThan(explosiveIdx);
  });

  it("swaps the Bulgarian split squat for the box step-up on Achilles days", () => {
    const plan = buildSessionPlan("lower_achilles");
    expect(plan.some((p) => p.slug === "bulgarian_split_squat")).toBe(false);
    expect(plan.some((p) => p.slug === "explosive_box_step_up")).toBe(true);
  });

  it("ramps the HSR calf prescription by program week", () => {
    const wk1 = buildSessionPlan("lower_achilles", { programWeek: 1 });
    const wk5 = buildSessionPlan("lower_achilles", { programWeek: 6 });
    const calf1 = wk1.find((p) => p.slug === "straight_knee_calf_raise")!;
    const calf5 = wk5.find((p) => p.slug === "straight_knee_calf_raise")!;
    expect(calf1.repHigh).toBe(12);
    expect(calf5.repHigh).toBe(8);
  });

  it("marks HSR calf raises flat-ground-only", () => {
    const plan = buildSessionPlan("lower_achilles");
    const calf = plan.find((p) => p.slug === "straight_knee_calf_raise")!;
    expect(calf.flatGroundOnly).toBe(true);
  });

  it("gates calf work when the pain gate is triggered", () => {
    const plan = buildSessionPlan("lower_achilles", {
      programWeek: 1,
      painGate: { triggered: true, reason: "pain 6/10" },
    });
    const calf = plan.find((p) => p.slug === "bent_knee_calf_raise")!;
    expect(calf.painGated).toBe(true);
  });

  it("hits the documented session time targets", () => {
    expect(SESSION_TEMPLATES.upper.targetDurationMinutes).toBe(35);
    expect(SESSION_TEMPLATES.lower.targetDurationMinutes).toBe(28);
    expect(SESSION_TEMPLATES.lower_achilles.targetDurationMinutes).toBe(46);
  });
});

describe("validateAchillesOrdering", () => {
  it("accepts explosive-before-slow-heavy", () => {
    const r = validateAchillesOrdering([
      "explosive_box_step_up",
      "straight_knee_calf_raise",
    ]);
    expect(r.valid).toBe(true);
  });

  it("rejects slow-heavy before explosive", () => {
    const r = validateAchillesOrdering([
      "straight_knee_calf_raise",
      "explosive_box_step_up",
    ]);
    expect(r.valid).toBe(false);
  });
});

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

  it("keeps the Bulgarian split squat alongside the box step-up on Achilles days", () => {
    // Coach feedback (Phase 1): the split squat stays on lower days at 15–25
    // slow-eccentric reps; the explosive box step-up is added, not swapped in.
    const plan = buildSessionPlan("lower_achilles");
    const split = plan.find((p) => p.slug === "bulgarian_split_squat");
    expect(split?.repLow).toBe(15);
    expect(split?.repHigh).toBe(25);
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
    expect(SESSION_TEMPLATES.upper.targetDurationMinutes).toBe(40);
    expect(SESSION_TEMPLATES.lower.targetDurationMinutes).toBe(35);
    expect(SESSION_TEMPLATES.lower_achilles.targetDurationMinutes).toBe(50);
  });
});

describe("ability scaling", () => {
  it("beginner drops a set and rests longer on non-HSR lifts", () => {
    const plan = buildSessionPlan("upper", { ability: "beginner" });
    expect(plan[0].sets).toBe(2);
    expect(plan[0].restSeconds).toBe(120);
  });

  it("advanced adds a set to the first two lifts only", () => {
    const plan = buildSessionPlan("upper", { ability: "advanced" });
    expect(plan[0].sets).toBe(4);
    expect(plan[1].sets).toBe(4);
    expect(plan[2].sets).toBe(3);
  });

  it("intermediate (and default) keeps the prescription", () => {
    const plan = buildSessionPlan("upper", {});
    expect(plan[0].sets).toBe(3);
    expect(plan[0].restSeconds).toBe(90);
  });

  it("HSR calf work keeps its rehab scheme regardless of ability", () => {
    const plan = buildSessionPlan("lower_achilles", { ability: "beginner", programWeek: 1 });
    const calf = plan.find((p) => p.slug === "straight_knee_calf_raise")!;
    expect(calf.sets).toBe(3); // week-based HSR scheme, not ability-scaled
  });
});

describe("rest preference override", () => {
  it("uses the athlete's rest choice on every regular lift (60 over the program's 90)", () => {
    const plan = buildSessionPlan("upper", { restSecondsOverride: 60 });
    expect(plan.every((p) => p.restSeconds === 60)).toBe(true);
  });

  it("overrides even the beginner +30 bump", () => {
    const plan = buildSessionPlan("upper", { ability: "beginner", restSecondsOverride: 45 });
    expect(plan[0].restSeconds).toBe(45); // not 90 + 30
  });

  it("leaves HSR rehab rest untouched by the override", () => {
    const plan = buildSessionPlan("lower_achilles", { restSecondsOverride: 30, programWeek: 1 });
    const calf = plan.find((p) => p.slug === "straight_knee_calf_raise")!;
    expect(calf.restSeconds).not.toBe(30);
  });

  it("falls back to program defaults when no override is set", () => {
    const plan = buildSessionPlan("upper", {});
    expect(plan[0].restSeconds).toBe(90);
  });
});

describe("running-plan phase backoff", () => {
  function totalSets(type: Parameters<typeof buildSessionPlan>[0], weekInfo: { phase: string; type: string } | null) {
    return buildSessionPlan(type, { weekInfo }).reduce((sum, ex) => sum + ex.sets, 0);
  }

  it("no running plan (standalone block) leaves the template's sets untouched", () => {
    const plan = buildSessionPlan("lower");
    const squat = plan.find((p) => p.slug === "db_squat")!;
    expect(squat.sets).toBe(3); // template default, no weekInfo passed at all
  });

  it("a peak week produces less strength volume than a build week", () => {
    const build = totalSets("lower", { phase: "build", type: "normal" });
    const peak = totalSets("lower", { phase: "peak", type: "normal" });
    expect(peak).toBeLessThan(build);
  });

  it("base and build carry the same, full load", () => {
    expect(totalSets("lower", { phase: "base", type: "normal" })).toBe(
      totalSets("lower", { phase: "build", type: "normal" })
    );
  });

  it("taper is maintenance only — less volume than a peak week", () => {
    const peak = totalSets("lower", { phase: "peak", type: "normal" });
    const taper = totalSets("lower", { phase: "taper", type: "normal" });
    expect(taper).toBeLessThan(peak);
  });

  it("a deload week deloads strength even inside the build phase", () => {
    const build = totalSets("lower", { phase: "build", type: "normal" });
    const deload = totalSets("lower", { phase: "build", type: "deload" });
    expect(deload).toBeLessThan(build);
  });

  it("race week is minimal — every flexible exercise floors at the phase-backoff minimum", () => {
    const plan = buildSessionPlan("lower", { weekInfo: { phase: "taper", type: "race" } });
    for (const ex of plan) {
      expect(ex.sets).toBe(1);
    }
  });

  it("never drops a lift below the 1-set phase-backoff floor", () => {
    const plan = buildSessionPlan("full_body", {
      ability: "beginner", // already reduced by ability scaling before phase applies
      weekInfo: { phase: "taper", type: "race" }, // the most aggressive backoff there is
    });
    for (const ex of plan) {
      expect(ex.sets).toBeGreaterThanOrEqual(1);
    }
  });

  it("Achilles-role work survives every phase unchanged by the backoff", () => {
    for (const weekInfo of [
      { phase: "base", type: "normal" },
      { phase: "peak", type: "normal" },
      { phase: "taper", type: "normal" },
      { phase: "taper", type: "race" },
    ] as const) {
      const plan = buildSessionPlan("lower_achilles", { weekInfo, programWeek: 1 });
      const explosive = plan.find((p) => p.slug === "explosive_box_step_up")!;
      const toeWalk = plan.find((p) => p.slug === "loaded_toe_walk")!;
      const hsr = plan.find((p) => p.slug === "straight_knee_calf_raise")!;
      expect(explosive.sets).toBe(3); // untouched by phase
      expect(toeWalk.sets).toBe(3); // untouched by phase
      expect(hsr.sets).toBe(3); // week-based HSR scheme, not phase
    }
  });

  it("composes with the pain gate: both apply, and neither cancels the other's caution", () => {
    const gated = buildSessionPlan("lower_achilles", {
      weekInfo: { phase: "peak", type: "normal" },
      programWeek: 1,
      painGate: { triggered: true, reason: "pain 6/10" },
    });
    const calf = gated.find((p) => p.slug === "bent_knee_calf_raise")!;
    const squat = gated.find((p) => p.slug === "db_squat")!;
    // Pain gate still caps the calf-work suggestion...
    expect(calf.painGated).toBe(true);
    // ...and the peak-week backoff still reduces ordinary lower-body volume.
    expect(squat.sets).toBe(2); // 3 (template) - 1 (peak)
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

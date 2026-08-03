import { describe, expect, it } from "vitest";
import { buildSessionPlan } from "../session";
import { RUNNING_FOCUS_POSTERIOR_CHAIN_SLUGS, sessionTemplateFor } from "../program";

// ── Kraft "per-user, not per-athlete" surface ─────────────────────────────────
//
// Covers the four gaps closed for the multi-user picker: an Achilles
// complaint schedules its own dedicated rehab session instead of needing its
// own three combo cards, the `goal` wizard question measurably changes
// generation, a session-level equipment override changes exercises without
// ever touching stored settings, and a session-level duration override is
// respected.

describe("achilles complaint on the standard programme types", () => {
  it("upper/lower/full_body never carry Achilles/HSR work — that's its own scheduled session now", () => {
    for (const type of ["upper", "lower", "full_body"] as const) {
      const plan = buildSessionPlan(type, { complaints: ["achilles"] });
      const slugs = plan.map((e) => e.slug);
      expect(slugs).not.toContain("explosive_box_step_up");
      expect(slugs).not.toContain("straight_knee_calf_raise");
      expect(slugs).not.toContain("bent_knee_calf_raise");
    }
  });

  it("explosive work still comes before slow-heavy HSR work on the dedicated achilles session", () => {
    const plan = buildSessionPlan("achilles", { complaints: ["achilles"] });
    const explosiveIdx = plan.findIndex((e) => e.slug === "explosive_box_step_up");
    const hsrIdx = plan.findIndex((e) => e.slug === "straight_knee_calf_raise");
    expect(explosiveIdx).toBeGreaterThanOrEqual(0);
    expect(hsrIdx).toBeGreaterThan(explosiveIdx);
  });

  it("no achilles work leaks into a standard session when the complaint isn't reported", () => {
    const plan = buildSessionPlan("lower", { complaints: [] });
    expect(plan.some((e) => e.slug === "explosive_box_step_up")).toBe(false);
  });
});

describe("historic *_achilles session types still load unchanged", () => {
  it("sessionTemplateFor returns the exact historic template for the dedicated types, ignoring complaints", () => {
    for (const type of ["achilles", "lower_achilles", "upper_achilles"] as const) {
      const plain = sessionTemplateFor(type, []);
      const withComplaint = sessionTemplateFor(type, ["achilles", "knee"]);
      expect(withComplaint.slots.map((s) => s.exerciseSlug)).toEqual(
        plain.slots.map((s) => s.exerciseSlug)
      );
    }
  });

  it("buildSessionPlan for a historic type still produces its original exercise list", () => {
    const plan = buildSessionPlan("lower_achilles");
    const slugs = plan.map((e) => e.slug);
    expect(slugs).toContain("explosive_box_step_up");
    expect(slugs).toContain("db_squat");
    expect(slugs).toContain("loaded_toe_walk");
  });
});

describe("goal measurably changes generation", () => {
  it("running_focus trims a set from upper-body work vs all_round/default", () => {
    const allRound = buildSessionPlan("upper", { goal: "all_round" });
    const runningFocus = buildSessionPlan("upper", { goal: "running_focus" });
    const overheadAllRound = allRound.find((e) => e.slug === "overhead_press")!;
    const overheadRunning = runningFocus.find((e) => e.slug === "overhead_press")!;
    expect(overheadRunning.sets).toBe(overheadAllRound.sets - 1);
  });

  it("running_focus adds a set to posterior-chain/unilateral lower work vs all_round", () => {
    const allRound = buildSessionPlan("lower", { goal: "all_round" });
    const runningFocus = buildSessionPlan("lower", { goal: "running_focus" });
    const hingeAllRound = allRound.find((e) => e.slug === "romanian_deadlift")!;
    const hingeRunning = runningFocus.find((e) => e.slug === "romanian_deadlift")!;
    expect(RUNNING_FOCUS_POSTERIOR_CHAIN_SLUGS.has("romanian_deadlift")).toBe(true);
    expect(hingeRunning.sets).toBe(hingeAllRound.sets + 1);
  });

  it("omitting goal behaves like all_round (no adjustment)", () => {
    const omitted = buildSessionPlan("upper");
    const allRound = buildSessionPlan("upper", { goal: "all_round" });
    expect(omitted.map((e) => e.sets)).toEqual(allRound.map((e) => e.sets));
  });

  it("never touches Achilles-role sets regardless of goal", () => {
    const allRound = buildSessionPlan("lower_achilles", { goal: "all_round" });
    const runningFocus = buildSessionPlan("lower_achilles", { goal: "running_focus" });
    const explosiveAllRound = allRound.find((e) => e.slug === "explosive_box_step_up")!;
    const explosiveRunning = runningFocus.find((e) => e.slug === "explosive_box_step_up")!;
    expect(explosiveRunning.sets).toBe(explosiveAllRound.sets);
  });
});

describe("session-level equipment override changes exercises, not stored settings", () => {
  it("buildSessionPlan resolves different exercises for a barbell override than a bodyweight one", () => {
    const barbell = buildSessionPlan("lower", { equipment: ["barbell"] });
    const bodyweight = buildSessionPlan("lower", { equipment: [] });
    expect(barbell.some((e) => e.slug === "barbell_back_squat")).toBe(true);
    expect(bodyweight.some((e) => e.slug === "barbell_back_squat")).toBe(false);
    expect(bodyweight.some((e) => e.slug === "air_squat")).toBe(true);
  });

  it("null/absent equipment (no override) keeps the template's own base exercise, unfiltered", () => {
    const noOverride = buildSessionPlan("lower");
    expect(noOverride.some((e) => e.slug === "db_squat")).toBe(true);
  });

  it("buildSessionPlan is pure — the same call twice with different equipment never mutates shared state", () => {
    const first = buildSessionPlan("lower", { equipment: ["barbell"] });
    const second = buildSessionPlan("lower", { equipment: [] });
    // Re-running the barbell call again must still return the barbell result
    // — proves the [] call above didn't leak into shared template/catalogue
    // state (the actual mechanism a per-session override without a
    // strength_plan_settings write depends on).
    const third = buildSessionPlan("lower", { equipment: ["barbell"] });
    expect(third.map((e) => e.slug)).toEqual(first.map((e) => e.slug));
    expect(second.map((e) => e.slug)).not.toEqual(first.map((e) => e.slug));
  });
});

describe("session-level duration override is respected", () => {
  it("a shorter target duration produces a smaller estimated plan than a longer one", () => {
    const short = buildSessionPlan("lower", { targetDurationMinutes: 20 });
    const long = buildSessionPlan("lower", { targetDurationMinutes: 60 });
    const shortSets = short.reduce((sum, e) => sum + e.sets, 0);
    const longSets = long.reduce((sum, e) => sum + e.sets, 0);
    expect(shortSets).toBeLessThan(longSets);
  });

  it("no targetDurationMinutes leaves every slot present at the template's own prescription — the override is opt-in", () => {
    const plain = buildSessionPlan("lower");
    const template = sessionTemplateFor("lower", []);
    expect(plain.map((e) => e.slug)).toEqual(template.slots.map((s) => s.exerciseSlug));
  });
});

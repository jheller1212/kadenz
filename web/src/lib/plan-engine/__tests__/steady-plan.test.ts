import { describe, expect, it } from "vitest";
import {
  generateSteadyPlan,
  generateReturnPlan,
  generatePlanForConfig,
  vdotForRunnerLevel,
} from "../plan-generator";
import type { PlanConfig } from "../types";

function makeDate(offsetWeeks = 0): Date {
  const d = new Date("2025-01-06T00:00:00.000Z"); // Monday
  d.setUTCDate(d.getUTCDate() + offsetWeeks * 7);
  return d;
}

const base: PlanConfig = {
  raceDistance: "10k", // ignored/overridden for non-race
  goalTimeSeconds: 0,
  startDate: makeDate(0),
  daysPerWeek: 4,
  trainingVolume: "medium",
  trainingDifficulty: "moderate",
  preferredLongRunDay: 0,
  hillyArea: false,
  currentWeeklyKm: 30,
  longRunCapKm: 0,
  raceElevation: "flat",
  easyRunMinKm: 0,
  runnerLevel: "intermediate",
};

function workoutTypes(plan: { weeks: { workouts: { type: string }[] }[] }): string[] {
  return plan.weeks.flatMap((w) => w.workouts.map((x) => x.type));
}

describe("generateSteadyPlan", () => {
  it("get_fit: right length, no race day/week, gently rising volume", () => {
    const plan = generateSteadyPlan({ ...base, intent: "get_fit", planLengthWeeks: 8 });
    expect(plan.intent).toBe("get_fit");
    expect(plan.planLengthWeeks).toBe(8);
    expect(plan.weeks).toHaveLength(8);
    expect(plan.weeks.every((w) => w.type !== "race")).toBe(true);
    expect(workoutTypes(plan).includes("race")).toBe(false);
    expect(plan.name).toBe("Get Fit — 8 weeks");

    // Non-deload weeks never jump more than ~10% over the previous non-deload.
    const normals = plan.weeks.filter((w) => w.type === "normal").map((w) => w.targetKm);
    for (let i = 1; i < normals.length; i++) {
      expect(normals[i]).toBeLessThanOrEqual(Math.round(normals[i - 1] * 1.1) + 1);
    }
    // Real, positive derived paces (synthetic goal time > 0).
    expect(plan.goalTimeSeconds).toBeGreaterThan(0);
    expect(plan.vdot).toBeGreaterThan(0);
  });

  it("maintain: flat volume on non-deload weeks, all base phase, no race", () => {
    const plan = generateSteadyPlan({ ...base, intent: "maintain", planLengthWeeks: 8 });
    expect(plan.intent).toBe("maintain");
    expect(plan.weeks.every((w) => w.phase === "base")).toBe(true);
    expect(workoutTypes(plan).includes("race")).toBe(false);
    const normals = plan.weeks.filter((w) => w.type === "normal").map((w) => w.targetKm);
    // All non-deload weeks target the same volume.
    expect(new Set(normals).size).toBe(1);
    expect(plan.name).toBe("Maintain — 8 weeks");
  });

  it("raceDate is the plan end (last Sunday), after start", () => {
    const plan = generateSteadyPlan({ ...base, intent: "get_fit", planLengthWeeks: 6 });
    expect(plan.raceDate.getTime()).toBeGreaterThan(plan.startDate.getTime());
  });

  it("rejects out-of-range plan length", () => {
    expect(() => generateSteadyPlan({ ...base, intent: "get_fit", planLengthWeeks: 2 })).toThrow();
    expect(() => generateSteadyPlan({ ...base, intent: "get_fit", planLengthWeeks: 40 })).toThrow();
  });
});

describe("generateReturnPlan", () => {
  it("starts with run/walk and ends continuous; no race day", () => {
    const plan = generateReturnPlan({ ...base, intent: "return", planLengthWeeks: 8 });
    expect(plan.intent).toBe("return");
    expect(plan.weeks).toHaveLength(8);
    expect(plan.name).toBe("Return to Running — 8 weeks");
    expect(workoutTypes(plan).includes("race")).toBe(false);

    // Week 1 has at least one run/walk session; final week has a continuous run.
    const week1Titles = plan.weeks[0].workouts.map((w) => w.title).join(" ");
    expect(week1Titles).toMatch(/Run\/Walk/);
    const lastTitles = plan.weeks[7].workouts.map((w) => w.title).join(" ");
    expect(lastTitles).toMatch(/Easy Run \d+ min/);

    // Every scheduled session carries the stop-on-pain safety note.
    const runs = plan.weeks.flatMap((w) => w.workouts).filter((w) => w.type !== "rest");
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((w) => /hurts?|pain/i.test(w.description ?? ""))).toBe(true);
  });

  it("caps sessions at 4/week even if more days offered", () => {
    const plan = generateReturnPlan({ ...base, intent: "return", planLengthWeeks: 6, daysPerWeek: 6 });
    expect(plan.daysPerWeek).toBe(4);
    const wk = plan.weeks[0].workouts.filter((w) => w.type !== "rest");
    expect(wk.length).toBeLessThanOrEqual(4);
  });

  it("consolidation (deload) week every 4th week, but the final week graduates", () => {
    const plan = generateReturnPlan({ ...base, intent: "return", planLengthWeeks: 8 });
    expect(plan.weeks[3].type).toBe("deload"); // week 4 consolidates
    expect(plan.weeks[7].type).toBe("normal"); // week 8 graduates to continuous
  });

  it("rejects out-of-range length", () => {
    expect(() => generateReturnPlan({ ...base, intent: "return", planLengthWeeks: 2 })).toThrow();
    expect(() => generateReturnPlan({ ...base, intent: "return", planLengthWeeks: 20 })).toThrow();
  });
});

describe("generatePlanForConfig dispatch", () => {
  it("routes race intent to the race generator (has a race day)", () => {
    const plan = generatePlanForConfig({
      ...base,
      intent: "race",
      raceDistance: "10k",
      goalTimeSeconds: 50 * 60,
      raceDate: makeDate(10),
    });
    expect(plan.intent).toBe("race");
    expect(workoutTypes(plan).includes("race")).toBe(true);
  });

  it("routes non-race intent to the steady generator (no race day)", () => {
    const plan = generatePlanForConfig({ ...base, intent: "get_fit", planLengthWeeks: 8 });
    expect(plan.intent).toBe("get_fit");
    expect(workoutTypes(plan).includes("race")).toBe(false);
  });

  it("routes return intent to the return generator", () => {
    const plan = generatePlanForConfig({ ...base, intent: "return", planLengthWeeks: 8 });
    expect(plan.intent).toBe("return");
    expect(plan.weeks[0].workouts.some((w) => /Run\/Walk/.test(w.title))).toBe(true);
  });

  it("defaults missing intent to race", () => {
    const plan = generatePlanForConfig({
      ...base,
      goalTimeSeconds: 50 * 60,
      raceDate: makeDate(10),
    });
    expect(plan.intent).toBe("race");
  });
});

describe("vdotForRunnerLevel", () => {
  it("increases with level and has a sane fallback", () => {
    expect(vdotForRunnerLevel("beginner")).toBeLessThan(vdotForRunnerLevel("elite"));
    expect(vdotForRunnerLevel(null)).toBeGreaterThan(0);
  });
});

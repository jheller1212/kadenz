import { describe, expect, it } from "vitest";
import {
  applyExerciseOrder,
  applyExerciseOverrides,
  buildSessionPlan,
  validateAchillesOrdering,
  type ExerciseOverride,
  type PlannedExercise,
} from "../session";
import { SESSION_TEMPLATES } from "../program";
import type { ExerciseSessionHistory } from "../types";

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

describe("non-Achilles complaint pain gate", () => {
  it("eases the work a reported complaint added when its gate is triggered", () => {
    const plan = buildSessionPlan("lower", {
      complaints: ["knee"],
      complaintPainGates: { knee: { triggered: true, reason: "Reported knee pain 6/10, easing knee work this session." } },
    });
    const stepDown = plan.find((p) => p.slug === "step_down")!;
    expect(stepDown.painGated).toBe(true);
    expect(stepDown.sets).toBe(2); // was 3, dropped one set, floored at 2
    expect(stepDown.progression.reason).toBe(
      "Reported knee pain 6/10, easing knee work this session."
    );
  });

  it("touches nothing else in the session", () => {
    const plan = buildSessionPlan("lower", {
      complaints: ["knee"],
      complaintPainGates: { knee: { triggered: true, reason: "eased" } },
    });
    for (const ex of plan) {
      if (ex.slug === "step_down") continue;
      expect(ex.painGated).toBe(false);
    }
  });

  it("a complaint with no logged pain (no gate entry) changes nothing", () => {
    const withoutGate = buildSessionPlan("lower", { complaints: ["knee"] });
    const withEmptyGates = buildSessionPlan("lower", { complaints: ["knee"], complaintPainGates: {} });
    const a = withoutGate.find((p) => p.slug === "step_down")!;
    const b = withEmptyGates.find((p) => p.slug === "step_down")!;
    expect(a.painGated).toBe(false);
    expect(a.sets).toBe(3);
    expect(b.painGated).toBe(false);
    expect(b.sets).toBe(3);
  });

  it("never eases another complaint's work", () => {
    const plan = buildSessionPlan("lower", {
      complaints: ["knee", "hamstring"],
      complaintPainGates: { knee: { triggered: true, reason: "eased" } },
    });
    const stepDown = plan.find((p) => p.slug === "step_down")!;
    const nordic = plan.find((p) => p.slug === "nordic_curl_negative")!;
    expect(stepDown.painGated).toBe(true);
    expect(nordic.painGated).toBe(false);
    expect(nordic.sets).toBe(3);
  });

  it("leaves Achilles/HSR work untouched by a non-Achilles complaint gate, sets stay locked", () => {
    // Achilles/HSR work is its own dedicated session now (see
    // program.ts sessionTemplateFor), not injected into "lower".
    const plan = buildSessionPlan("achilles", {
      complaints: ["achilles", "knee"],
      programWeek: 1,
      complaintPainGates: { knee: { triggered: true, reason: "eased" } },
    });
    const calf = plan.find((p) => p.slug === "bent_knee_calf_raise")!;
    expect(calf.painGated).toBe(false);
    expect(calf.setsLocked).toBe(true);
  });

  it("Achilles's own gate still eases HSR work exactly as before, locked sets included", () => {
    const plan = buildSessionPlan("achilles", {
      complaints: ["achilles"],
      programWeek: 1,
      painGate: { triggered: true, reason: "pain 6/10" },
    });
    const calf = plan.find((p) => p.slug === "bent_knee_calf_raise")!;
    expect(calf.painGated).toBe(true);
    expect(calf.setsLocked).toBe(true);
  });

  it("an athlete with no complaints is unaffected", () => {
    const plan = buildSessionPlan("lower", {
      complaintPainGates: { knee: { triggered: true, reason: "eased" } },
    });
    expect(plan.some((p) => p.slug === "step_down")).toBe(false);
    for (const ex of plan) expect(ex.painGated).toBe(false);
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

describe("running-plan phase intensity", () => {
  function threeWorkingSets(weightKg: number, reps: number, date = new Date("2026-01-01")): ExerciseSessionHistory {
    return {
      sessionId: "s1",
      date,
      sets: [1, 2, 3].map((setNumber) => ({
        setNumber,
        weightKg,
        reps,
        rpe: null,
        kind: null,
      })),
    };
  }

  it("compresses a build-phase primary slot's rep range, unlike base", () => {
    const base = buildSessionPlan("lower", { weekInfo: { phase: "base", type: "normal" } });
    const build = buildSessionPlan("lower", { weekInfo: { phase: "build", type: "normal" } });
    const baseSquat = base.find((p) => p.slug === "db_squat")!;
    const buildSquat = build.find((p) => p.slug === "db_squat")!;
    expect(baseSquat.repLow).toBe(8);
    expect(baseSquat.repHigh).toBe(12);
    expect(buildSquat.repLow).toBe(4);
    expect(buildSquat.repHigh).toBe(6);
  });

  it("peak and taper keep build's compressed range rather than reverting toward base", () => {
    for (const phase of ["build", "peak", "taper"] as const) {
      const plan = buildSessionPlan("lower", { weekInfo: { phase, type: "normal" } });
      const squat = plan.find((p) => p.slug === "db_squat")!;
      expect(squat.repLow).toBe(4);
      expect(squat.repHigh).toBe(6);
    }
  });

  it("leaves an accessory slot's rep range untouched by phase", () => {
    const plan = buildSessionPlan("lower", { weekInfo: { phase: "build", type: "normal" } });
    const splitSquat = plan.find((p) => p.slug === "bulgarian_split_squat")!;
    expect(splitSquat.repLow).toBe(15);
    expect(splitSquat.repHigh).toBe(25);
  });

  it("leaves HSR calf work untouched by phase", () => {
    const plan = buildSessionPlan("lower_achilles", {
      weekInfo: { phase: "build", type: "normal" },
      programWeek: 1,
    });
    const hsr = plan.find((p) => p.slug === "straight_knee_calf_raise")!;
    expect(hsr.repLow).toBe(12);
    expect(hsr.repHigh).toBe(12);
  });

  it("a deload/race week keeps whatever phase's range it sits inside", () => {
    const normal = buildSessionPlan("lower", { weekInfo: { phase: "build", type: "normal" } });
    const deload = buildSessionPlan("lower", { weekInfo: { phase: "build", type: "deload" } });
    const race = buildSessionPlan("lower", { weekInfo: { phase: "build", type: "race" } });
    const squatN = normal.find((p) => p.slug === "db_squat")!;
    const squatD = deload.find((p) => p.slug === "db_squat")!;
    const squatR = race.find((p) => p.slug === "db_squat")!;
    expect([squatD.repLow, squatD.repHigh]).toEqual([squatN.repLow, squatN.repHigh]);
    expect([squatR.repLow, squatR.repHigh]).toEqual([squatN.repLow, squatN.repHigh]);
  });

  it("threads the phase-resolved range into suggestProgression, not just the display", () => {
    // Three sets at 6 reps: at the top of the compressed build range (4-6)
    // but well below the top of base's range (8-12).
    const historyBySlug = { db_squat: [threeWorkingSets(20, 6)] };
    const base = buildSessionPlan("lower", {
      weekInfo: { phase: "base", type: "normal" },
      historyBySlug,
    });
    const build = buildSessionPlan("lower", {
      weekInfo: { phase: "build", type: "normal" },
      historyBySlug,
    });
    const baseSquat = base.find((p) => p.slug === "db_squat")!;
    const buildSquat = build.find((p) => p.slug === "db_squat")!;
    // Judged against base's 8-12, 6 reps doesn't reach the top → hold.
    expect(baseSquat.progression.action).not.toBe("increase");
    // Judged against build's own 4-6 (what's actually displayed), 6 reps IS
    // the top of every working set → increase. If progression were still
    // judging against the static 8-12, this would incorrectly hold too.
    expect(buildSquat.progression.action).toBe("increase");
  });

  it("holds instead of suggesting an increase across a base→build transition", () => {
    // history[0] was logged in a base-phase session (8-12), now judged
    // against build's 4-6 — 6 reps trivially clears build's rep-high, but
    // that's a phase-transition artefact, not real evidence at this range.
    const lastSessionDate = new Date("2026-01-01");
    const historyBySlug = { db_squat: [threeWorkingSets(20, 6, lastSessionDate)] };
    const plan = buildSessionPlan("lower", {
      weekInfo: { phase: "build", type: "normal" },
      historyBySlug,
      weekInfoForDate: (date) =>
        date.getTime() === lastSessionDate.getTime() ? { phase: "base", type: "normal" } : null,
    });
    const squat = plan.find((p) => p.slug === "db_squat")!;
    expect(squat.progression.action).toBe("hold");
    expect(squat.progression.reason).toMatch(/new rep range/i);
  });

  it("without a resolvable last-session phase, the guard stays inert (pre-existing behaviour)", () => {
    const lastSessionDate = new Date("2026-01-01");
    const historyBySlug = { db_squat: [threeWorkingSets(20, 6, lastSessionDate)] };
    const plan = buildSessionPlan("lower", {
      weekInfo: { phase: "build", type: "normal" },
      historyBySlug,
      // No weekInfoForDate supplied — matches every call site before this option existed.
    });
    const squat = plan.find((p) => p.slug === "db_squat")!;
    expect(squat.progression.action).toBe("increase");
  });
});

describe("applyExerciseOrder", () => {
  const plan = ["a", "b", "c"].map((slug) => ({ slug }) as PlannedExercise);
  const slugs = (list: PlannedExercise[]) => list.map((e) => e.slug);

  it("leaves the plan alone when there is no stored order", () => {
    expect(slugs(applyExerciseOrder(plan, null))).toEqual(["a", "b", "c"]);
    expect(slugs(applyExerciseOrder(plan, []))).toEqual(["a", "b", "c"]);
  });

  it("reorders the plan to the stored order", () => {
    expect(slugs(applyExerciseOrder(plan, ["c", "a", "b"]))).toEqual(["c", "a", "b"]);
  });

  it("ignores a stored slug the plan no longer contains", () => {
    expect(slugs(applyExerciseOrder(plan, ["c", "gone", "a", "b"]))).toEqual(["c", "a", "b"]);
  });

  it("keeps a plan exercise that is missing from the stored order, after the placed ones", () => {
    // "b" is new relative to this order (a template or equipment change), so
    // it moves to the end rather than being dropped off the screen.
    expect(slugs(applyExerciseOrder(plan, ["c", "a"]))).toEqual(["c", "a", "b"]);
  });

  it("keeps plan order among several unplaced exercises", () => {
    expect(slugs(applyExerciseOrder(plan, ["c"]))).toEqual(["c", "a", "b"]);
  });

  it("does not mutate the plan it was given", () => {
    applyExerciseOrder(plan, ["c", "b", "a"]);
    expect(slugs(plan)).toEqual(["a", "b", "c"]);
  });
});

describe("applyExerciseOverrides", () => {
  const ctx = { historyBySlug: {}, lifterProfile: null };

  it("swaps in the replacement exercise at the original slot, keeping sets/reps/rest", () => {
    const plan = buildSessionPlan("lower");
    const original = plan.find((p) => p.slug === "db_squat")!;
    const overrides: ExerciseOverride[] = [
      { slug: "db_squat", action: "swapped", replacementSlug: "romanian_deadlift" },
    ];
    const result = applyExerciseOverrides(plan, overrides, ctx);
    const idx = plan.findIndex((p) => p.slug === "db_squat");
    expect(result[idx].slug).toBe("romanian_deadlift");
    expect(result[idx].sets).toBe(original.sets);
    expect(result[idx].repLow).toBe(original.repLow);
    expect(result[idx].repHigh).toBe(original.repHigh);
    expect(result[idx].restSeconds).toBe(original.restSeconds);
  });

  // A swap made from the pre-start sheet (page.tsx exchangeExercise) is
  // persisted the same way as one made mid-session (GuidedSession
  // patchOverride): appended to the session's exerciseOverrides column and
  // re-applied here on every GET. This mirrors exactly that read path — the
  // plan rebuilt from scratch twice, from a stored override, both times.
  it("a swap made before starting survives a rebuild of the plan", () => {
    const overrides: ExerciseOverride[] = [
      { slug: "db_squat", action: "swapped", replacementSlug: "single_leg_calf_raise" },
    ];
    const rebuiltOnce = applyExerciseOverrides(buildSessionPlan("lower"), overrides, ctx);
    const rebuiltAgain = applyExerciseOverrides(buildSessionPlan("lower"), overrides, ctx);
    expect(rebuiltOnce.some((p) => p.slug === "single_leg_calf_raise")).toBe(true);
    expect(rebuiltAgain.some((p) => p.slug === "single_leg_calf_raise")).toBe(true);
    expect(rebuiltOnce.some((p) => p.slug === "db_squat")).toBe(false);
  });

  it("chains a second exchange onto the slot the first exchange already produced", () => {
    // wall_sit (not a "lower" template slot on its own) stands in as the
    // intermediate so the second override's `slug` unambiguously targets
    // the slot the first override just produced, not a same-named slot the
    // template already had elsewhere (e.g. romanian_deadlift is its own
    // slot in "lower" — swapping onto it would collide with that).
    const overrides: ExerciseOverride[] = [
      { slug: "db_squat", action: "swapped", replacementSlug: "wall_sit" },
      { slug: "wall_sit", action: "swapped", replacementSlug: "single_leg_calf_raise" },
    ];
    const result = applyExerciseOverrides(buildSessionPlan("lower"), overrides, ctx);
    expect(result.some((p) => p.slug === "single_leg_calf_raise")).toBe(true);
    expect(result.some((p) => p.slug === "wall_sit")).toBe(false);
    expect(result.some((p) => p.slug === "db_squat")).toBe(false);
  });

  it("never swaps in Achilles-role work — that's rehab, not filler", () => {
    const overrides: ExerciseOverride[] = [
      { slug: "db_squat", action: "swapped", replacementSlug: "explosive_box_step_up" },
    ];
    const result = applyExerciseOverrides(buildSessionPlan("lower"), overrides, ctx);
    // The Achilles-role replacement is rejected, so the slot is untouched.
    expect(result.some((p) => p.slug === "db_squat")).toBe(true);
    expect(result.some((p) => p.slug === "explosive_box_step_up")).toBe(false);
  });

  it("drops a removed exercise instead of swapping it", () => {
    const overrides: ExerciseOverride[] = [{ slug: "db_squat", action: "removed" }];
    const result = applyExerciseOverrides(buildSessionPlan("lower"), overrides, ctx);
    expect(result.some((p) => p.slug === "db_squat")).toBe(false);
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

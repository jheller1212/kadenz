import { describe, expect, it } from "vitest";
import { generatePlan } from "../plan-generator";
import type { PlanConfig } from "../types";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeDate(offsetWeeks = 0): Date {
  const d = new Date("2025-01-06T00:00:00.000Z"); // Monday
  d.setUTCDate(d.getUTCDate() + offsetWeeks * 7);
  return d;
}

const marathonConfig: PlanConfig = {
  raceDistance: "marathon",
  goalTimeSeconds: 4 * 3600, // 4:00:00
  startDate: makeDate(0),
  raceDate: makeDate(16),
  daysPerWeek: 4,
  trainingVolume: "medium",
  trainingDifficulty: "moderate",
  preferredLongRunDay: 0, // Sunday
  hillyArea: false,
  currentWeeklyKm: 30,
  longRunCapKm: 0,
};

const halfConfig: PlanConfig = {
  raceDistance: "half",
  goalTimeSeconds: 2 * 3600, // 2:00:00
  startDate: makeDate(0),
  raceDate: makeDate(12),
  daysPerWeek: 4,
  trainingVolume: "medium",
  trainingDifficulty: "moderate",
  preferredLongRunDay: 6, // Saturday
  hillyArea: false,
  currentWeeklyKm: 25,
  longRunCapKm: 0,
};

const fiveKConfig: PlanConfig = {
  raceDistance: "5k",
  goalTimeSeconds: 25 * 60, // 25:00
  startDate: makeDate(0),
  raceDate: makeDate(8),
  daysPerWeek: 3,
  trainingVolume: "low",
  trainingDifficulty: "easy",
  preferredLongRunDay: 0, // Sunday
  hillyArea: false,
  currentWeeklyKm: 15,
  longRunCapKm: 0,
};

// ── Validation ────────────────────────────────────────────────────────────────

describe("generatePlan — input validation", () => {
  it("throws when daysPerWeek < 2", () => {
    expect(() =>
      generatePlan({ ...marathonConfig, daysPerWeek: 1 })
    ).toThrow("daysPerWeek");
  });

  it("accepts daysPerWeek of 2 (Benchmark-style onboarding minimum)", () => {
    const plan = generatePlan({ ...marathonConfig, daysPerWeek: 2 });
    expect(plan.daysPerWeek).toBe(2);
  });

  it("throws when daysPerWeek > 6", () => {
    expect(() =>
      generatePlan({ ...marathonConfig, daysPerWeek: 7 })
    ).toThrow("daysPerWeek");
  });

  it("throws when goalTimeSeconds <= 0", () => {
    expect(() =>
      generatePlan({ ...marathonConfig, goalTimeSeconds: 0 })
    ).toThrow("goalTimeSeconds");
  });

  it("throws when raceDate is not after startDate", () => {
    expect(() =>
      generatePlan({ ...marathonConfig, raceDate: marathonConfig.startDate })
    ).toThrow("raceDate");
  });
});

// ── Plan metadata ────────────────────────────────────────────────────────────

describe("generatePlan — plan metadata", () => {
  it("returns correct raceDistance and goalTimeSeconds", () => {
    const plan = generatePlan(marathonConfig);
    expect(plan.raceDistance).toBe("marathon");
    expect(plan.goalTimeSeconds).toBe(4 * 3600);
  });

  it("derives a positive VDOT", () => {
    const plan = generatePlan(marathonConfig);
    expect(plan.vdot).toBeGreaterThan(0);
  });

  it("plan name includes race label and goal time", () => {
    const plan = generatePlan(marathonConfig);
    expect(plan.name).toContain("Marathon");
    expect(plan.name).toContain("4:00:00");
  });

  it("plan length matches number of weeks generated", () => {
    const plan = generatePlan(marathonConfig);
    expect(plan.weeks).toHaveLength(plan.planLengthWeeks);
  });

  it("returns correct daysPerWeek", () => {
    const plan = generatePlan(marathonConfig);
    expect(plan.daysPerWeek).toBe(4);
  });

  it("preserves hillyArea flag", () => {
    const hillyPlan = generatePlan({ ...marathonConfig, hillyArea: true });
    expect(hillyPlan.hillyArea).toBe(true);
  });
});

// ── Phase distribution ───────────────────────────────────────────────────────

describe("generatePlan — phase distribution", () => {
  it("all weeks have a valid phase", () => {
    const plan = generatePlan(marathonConfig);
    const validPhases = new Set(["base", "build", "peak", "taper"]);
    for (const week of plan.weeks) {
      expect(validPhases.has(week.phase)).toBe(true);
    }
  });

  it("phases appear in order: base → build → peak → taper", () => {
    const plan = generatePlan(marathonConfig);
    const phaseOrder = ["base", "build", "peak", "taper"];
    let lastPhaseIndex = -1;
    for (const week of plan.weeks) {
      const idx = phaseOrder.indexOf(week.phase);
      expect(idx).toBeGreaterThanOrEqual(lastPhaseIndex);
      lastPhaseIndex = idx;
    }
  });

  it("last week is race type", () => {
    const plan = generatePlan(marathonConfig);
    const lastWeek = plan.weeks[plan.weeks.length - 1];
    expect(lastWeek.type).toBe("race");
  });

  it("taper weeks exist near the end", () => {
    const plan = generatePlan(marathonConfig);
    const taperWeeks = plan.weeks.filter((w) => w.phase === "taper");
    expect(taperWeeks.length).toBeGreaterThan(0);
  });
});

// ── Week types ───────────────────────────────────────────────────────────────

describe("generatePlan — week types", () => {
  it("deload weeks have lower volume than adjacent normal weeks in same phase", () => {
    const plan = generatePlan(marathonConfig);
    const deloads = plan.weeks.filter((w) => w.type === "deload");
    expect(deloads.length).toBeGreaterThan(0);

    for (const deload of deloads) {
      const deloadIdx = plan.weeks.indexOf(deload);
      if (deloadIdx > 0) {
        expect(deload.targetKm).toBeLessThan(
          plan.weeks[deloadIdx - 1].targetKm
        );
      }
    }
  });

  it("all week types are valid enum values", () => {
    const plan = generatePlan(marathonConfig);
    const validTypes = new Set(["normal", "deload", "race"]);
    for (const week of plan.weeks) {
      expect(validTypes.has(week.type)).toBe(true);
    }
  });
});

// ── Volume progression ───────────────────────────────────────────────────────

describe("generatePlan — volume progression", () => {
  it("all weeks have positive targetKm", () => {
    const plan = generatePlan(marathonConfig);
    for (const week of plan.weeks) {
      expect(week.targetKm).toBeGreaterThan(0);
    }
  });

  it("peak phase has higher volume than base phase", () => {
    const plan = generatePlan(marathonConfig);
    const baseWeeks = plan.weeks.filter((w) => w.phase === "base" && w.type === "normal");
    const peakWeeks = plan.weeks.filter((w) => w.phase === "peak" && w.type === "normal");

    if (baseWeeks.length > 0 && peakWeeks.length > 0) {
      const avgBase = baseWeeks.reduce((s, w) => s + w.targetKm, 0) / baseWeeks.length;
      const avgPeak = peakWeeks.reduce((s, w) => s + w.targetKm, 0) / peakWeeks.length;
      expect(avgPeak).toBeGreaterThan(avgBase);
    }
  });

  it("taper weeks have lower volume than peak weeks", () => {
    const plan = generatePlan(marathonConfig);
    const peakNormal = plan.weeks.filter((w) => w.phase === "peak" && w.type === "normal");
    const taperWeeks = plan.weeks.filter((w) => w.phase === "taper" && w.type !== "race");

    if (peakNormal.length > 0 && taperWeeks.length > 0) {
      const maxPeak = Math.max(...peakNormal.map((w) => w.targetKm));
      const avgTaper = taperWeeks.reduce((s, w) => s + w.targetKm, 0) / taperWeeks.length;
      expect(avgTaper).toBeLessThan(maxPeak);
    }
  });

  it("respects longRunCapKm when set", () => {
    const plan = generatePlan({ ...marathonConfig, longRunCapKm: 25 });
    for (const week of plan.weeks) {
      const longRun = week.workouts.find((w) => w.type === "long");
      if (longRun?.targetKm) {
        expect(longRun.targetKm).toBeLessThanOrEqual(25);
      }
    }
  });

  it("week targetKm equals the sum of its scheduled workouts (no phantom volume)", () => {
    // Reported bug: 50 km/wk target, long capped at 16, easy min 10, 4 days →
    // schedules 1×16 + 3×easy but the week still displayed the un-schedulable
    // ramp target, so the header total/max didn't match the actual runs.
    const plan = generatePlan({
      ...marathonConfig,
      currentWeeklyKm: 50,
      daysPerWeek: 4,
      longRunCapKm: 16,
      easyRunMinKm: 10,
    });
    for (const week of plan.weeks) {
      const scheduled = week.workouts.reduce((s, w) => s + (w.targetKm ?? 0), 0);
      expect(week.targetKm).toBe(Math.round(scheduled));
    }
  });

  it("absorbs overflow into easy runs when the long-run cap is binding", () => {
    // With a hard 16 km cap and only 4 days, the leftover weekly volume must go
    // into the easy runs (kept under the long run) rather than being discarded.
    const plan = generatePlan({
      ...marathonConfig,
      currentWeeklyKm: 50,
      daysPerWeek: 4,
      longRunCapKm: 16,
      easyRunMinKm: 10,
    });
    for (const week of plan.weeks) {
      if (week.type !== "normal") continue;
      const longRun = week.workouts.find((w) => w.type === "long");
      const easies = week.workouts.filter((w) => w.type === "easy");
      if (!longRun?.targetKm || easies.length === 0) continue;
      // Long run honored the cap …
      expect(longRun.targetKm).toBeLessThanOrEqual(16);
      // … and every easy run stays strictly shorter than the long run.
      for (const e of easies) {
        expect(e.targetKm!).toBeLessThan(longRun.targetKm);
      }
    }
  });

  it("high volume plan has more km than low volume plan", () => {
    const low = generatePlan({ ...marathonConfig, trainingVolume: "low" });
    const high = generatePlan({ ...marathonConfig, trainingVolume: "high" });
    const totalLow = low.weeks.reduce((s, w) => s + w.targetKm, 0);
    const totalHigh = high.weeks.reduce((s, w) => s + w.targetKm, 0);
    expect(totalHigh).toBeGreaterThan(totalLow);
  });
});

// ── Workout structure ────────────────────────────────────────────────────────

describe("generatePlan — workout structure", () => {
  it("each week has exactly 7 workouts (one per day)", () => {
    const plan = generatePlan(marathonConfig);
    for (const week of plan.weeks) {
      expect(week.workouts).toHaveLength(7);
    }
  });

  it("each week has exactly one long run (except race week)", () => {
    const plan = generatePlan(marathonConfig);
    for (const week of plan.weeks) {
      if (week.type === "race") continue;
      const longRuns = week.workouts.filter((w) => w.type === "long");
      expect(longRuns).toHaveLength(1);
    }
  });

  it("long run falls on the preferred day", () => {
    const plan = generatePlan(marathonConfig);
    for (const week of plan.weeks) {
      if (week.type === "race") continue;
      const longRun = week.workouts.find((w) => w.type === "long");
      if (longRun) {
        expect(longRun.dayOfWeek).toBe(marathonConfig.preferredLongRunDay);
      }
    }
  });

  it("race week contains exactly one race workout on the actual race date", () => {
    const plan = generatePlan(marathonConfig);
    const raceWeek = plan.weeks.find((w) => w.type === "race");
    expect(raceWeek).toBeDefined();
    const raceWorkout = raceWeek!.workouts.filter((w) => w.type === "race");
    expect(raceWorkout).toHaveLength(1);
    expect(raceWorkout[0].dayOfWeek).toBe(marathonConfig.raceDate.getUTCDay());
  });

  it("base phase has no interval or tempo workouts", () => {
    const plan = generatePlan(marathonConfig);
    const baseWeeks = plan.weeks.filter((w) => w.phase === "base");
    for (const week of baseWeeks) {
      const quality = week.workouts.filter(
        (w) => w.type === "tempo" || w.type === "interval"
      );
      expect(quality).toHaveLength(0);
    }
  });

  it("build/peak phases include at least one quality session per week for moderate difficulty", () => {
    const plan = generatePlan(marathonConfig); // moderate difficulty
    const buildPeakWeeks = plan.weeks.filter(
      (w) => (w.phase === "build" || w.phase === "peak") && w.type === "normal"
    );
    for (const week of buildPeakWeeks) {
      const quality = week.workouts.filter(
        (w) => w.type === "tempo" || w.type === "interval"
      );
      expect(quality.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("all workout dayOfWeek values are 0–6", () => {
    const plan = generatePlan(marathonConfig);
    for (const week of plan.weeks) {
      for (const workout of week.workouts) {
        expect(workout.dayOfWeek).toBeGreaterThanOrEqual(0);
        expect(workout.dayOfWeek).toBeLessThanOrEqual(6);
      }
    }
  });

  it("each day of week appears exactly once per week", () => {
    const plan = generatePlan(marathonConfig);
    for (const week of plan.weeks) {
      const days = week.workouts.map((w) => w.dayOfWeek);
      const unique = new Set(days);
      expect(unique.size).toBe(7);
    }
  });

  it("all workouts have valid types", () => {
    const plan = generatePlan(marathonConfig);
    const validTypes = new Set([
      "easy",
      "long",
      "tempo",
      "interval",
      "recovery",
      "race",
      "rest",
    ]);
    for (const week of plan.weeks) {
      for (const workout of week.workouts) {
        expect(validTypes.has(workout.type)).toBe(true);
      }
    }
  });

  it("rest days have no blocks", () => {
    const plan = generatePlan(marathonConfig);
    for (const week of plan.weeks) {
      for (const workout of week.workouts) {
        if (workout.type === "rest") {
          expect(workout.blocks).toHaveLength(0);
        }
      }
    }
  });
});

// ── Block structure ──────────────────────────────────────────────────────────

describe("generatePlan — block structure", () => {
  it("easy runs have at least one work block", () => {
    const plan = generatePlan(marathonConfig);
    for (const week of plan.weeks) {
      for (const workout of week.workouts) {
        if (workout.type === "easy") {
          const workBlocks = workout.blocks.filter((b) => b.type === "work");
          expect(workBlocks.length).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it("tempo workouts have warmup, work, and cooldown blocks", () => {
    const plan = generatePlan(marathonConfig);
    let foundTempo = false;
    for (const week of plan.weeks) {
      for (const workout of week.workouts) {
        if (workout.type === "tempo") {
          foundTempo = true;
          const types = workout.blocks.map((b) => b.type);
          expect(types).toContain("warmup");
          expect(types).toContain("work");
          expect(types).toContain("cooldown");
        }
      }
    }
    // Plan should have at least one tempo (build/peak exists in 16-week plan)
    expect(foundTempo).toBe(true);
  });

  it("interval workouts have warmup, work, recovery, and cooldown blocks", () => {
    // Use hard difficulty to ensure intervals are generated
    const plan = generatePlan({
      ...marathonConfig,
      trainingDifficulty: "hard",
    });
    let foundInterval = false;
    for (const week of plan.weeks) {
      for (const workout of week.workouts) {
        if (workout.type === "interval") {
          foundInterval = true;
          const types = workout.blocks.map((b) => b.type);
          expect(types).toContain("warmup");
          expect(types).toContain("work");
          expect(types).toContain("recovery");
          expect(types).toContain("cooldown");
        }
      }
    }
    expect(foundInterval).toBe(true);
  });

  it("all blocks have valid block types", () => {
    const plan = generatePlan(marathonConfig);
    const validTypes = new Set(["warmup", "work", "recovery", "cooldown"]);
    for (const week of plan.weeks) {
      for (const workout of week.workouts) {
        for (const block of workout.blocks) {
          expect(validTypes.has(block.type)).toBe(true);
        }
      }
    }
  });

  it("work blocks have pace targets (for non-rest workouts)", () => {
    const plan = generatePlan(marathonConfig);
    for (const week of plan.weeks) {
      for (const workout of week.workouts) {
        if (workout.type === "rest") continue;
        for (const block of workout.blocks) {
          if (block.type === "work" && !block.reps) {
            // Distance-based work blocks should have a pace
            expect(block.targetPaceSecKm).toBeDefined();
            expect(block.targetPaceSecKm).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("block sort orders are unique and non-negative within a workout", () => {
    const plan = generatePlan(marathonConfig);
    for (const week of plan.weeks) {
      for (const workout of week.workouts) {
        const orders = workout.blocks.map((b) => b.sortOrder);
        const unique = new Set(orders);
        expect(unique.size).toBe(orders.length);
        for (const o of orders) {
          expect(o).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

// ── Hilly area adjustment ────────────────────────────────────────────────────

describe("generatePlan — hilly area", () => {
  it("hilly plan has slower (higher) pace targets than flat plan for easy runs", () => {
    const flat = generatePlan({ ...marathonConfig, hillyArea: false });
    const hilly = generatePlan({ ...marathonConfig, hillyArea: true });

    const getFirstEasyPace = (plan: ReturnType<typeof generatePlan>) => {
      for (const week of plan.weeks) {
        for (const workout of week.workouts) {
          if (workout.type === "easy") {
            const workBlock = workout.blocks.find((b) => b.type === "work");
            if (workBlock?.targetPaceSecKm) return workBlock.targetPaceSecKm;
          }
        }
      }
      return null;
    };

    const flatPace = getFirstEasyPace(flat);
    const hillyPace = getFirstEasyPace(hilly);
    expect(flatPace).not.toBeNull();
    expect(hillyPace).not.toBeNull();
    expect(hillyPace!).toBeGreaterThan(flatPace!);
  });
});

// ── Workout dates ────────────────────────────────────────────────────────────

describe("generatePlan — workout dates", () => {
  it("workout dates are contiguous week by week", () => {
    const plan = generatePlan(marathonConfig);
    for (let i = 1; i < plan.weeks.length; i++) {
      const prevLastDate = Math.max(
        ...plan.weeks[i - 1].workouts.map((w) => w.date.getTime())
      );
      const currFirstDate = Math.min(
        ...plan.weeks[i].workouts.map((w) => w.date.getTime())
      );
      // current week starts after previous week's last day
      expect(currFirstDate).toBeGreaterThan(prevLastDate - 24 * 3600 * 1000);
    }
  });

  it("workout dayOfWeek matches the actual date", () => {
    const plan = generatePlan(marathonConfig);
    for (const week of plan.weeks) {
      for (const workout of week.workouts) {
        // getUTCDay() returns 0=Sun … 6=Sat
        expect(workout.date.getUTCDay()).toBe(workout.dayOfWeek);
      }
    }
  });
});

// ── Multiple race distances ──────────────────────────────────────────────────

describe("generatePlan — different race distances", () => {
  it("generates a valid plan for a half marathon", () => {
    const plan = generatePlan(halfConfig);
    expect(plan.raceDistance).toBe("half");
    expect(plan.weeks.length).toBeGreaterThanOrEqual(4);
    expect(plan.vdot).toBeGreaterThan(0);
  });

  it("generates a valid plan for a 5K", () => {
    const plan = generatePlan(fiveKConfig);
    expect(plan.raceDistance).toBe("5k");
    expect(plan.weeks.length).toBeGreaterThanOrEqual(4);
  });

  it("generates a valid plan for a 10K", () => {
    const plan = generatePlan({
      ...marathonConfig,
      raceDistance: "10k",
      goalTimeSeconds: 50 * 60,
      raceDate: makeDate(10),
    });
    expect(plan.raceDistance).toBe("10k");
    expect(plan.weeks.length).toBeGreaterThanOrEqual(4);
  });
});

// ── Preferred long run day variation ────────────────────────────────────────

describe("generatePlan — preferred long run day", () => {
  it("long run falls on Saturday when preferred day is 6", () => {
    const plan = generatePlan({ ...marathonConfig, preferredLongRunDay: 6 });
    for (const week of plan.weeks) {
      if (week.type === "race") continue;
      const longRun = week.workouts.find((w) => w.type === "long");
      if (longRun) {
        expect(longRun.dayOfWeek).toBe(6);
      }
    }
  });

  it("long run falls on Wednesday when preferred day is 3", () => {
    const plan = generatePlan({ ...marathonConfig, preferredLongRunDay: 3 });
    for (const week of plan.weeks) {
      if (week.type === "race") continue;
      const longRun = week.workouts.find((w) => w.type === "long");
      if (longRun) {
        expect(longRun.dayOfWeek).toBe(3);
      }
    }
  });
});

// ── Explicit available days ──────────────────────────────────────────────────

describe("generatePlan — availableDays", () => {
  const chosenDays = [2, 4, 6, 0]; // Tue, Thu, Sat, Sun
  const configWithDays: PlanConfig = {
    ...marathonConfig,
    daysPerWeek: 4,
    preferredLongRunDay: 0, // Sunday — in the set
    availableDays: chosenDays,
  };

  it("schedules runs ONLY on the chosen days (non-race weeks)", () => {
    const plan = generatePlan(configWithDays);
    const allowed = new Set(chosenDays);
    for (const week of plan.weeks) {
      if (week.type === "race") continue; // race day may override
      for (const workout of week.workouts) {
        if (workout.type === "rest") continue;
        expect(allowed.has(workout.dayOfWeek)).toBe(true);
      }
    }
  });

  it("places the long run on the preferred day when it is in the set", () => {
    const plan = generatePlan(configWithDays);
    for (const week of plan.weeks) {
      if (week.type === "race") continue;
      const longRun = week.workouts.find((w) => w.type === "long");
      expect(longRun?.dayOfWeek).toBe(0);
    }
  });

  it("falls back to the latest available day when preferred long-run day is not in the set", () => {
    const plan = generatePlan({
      ...configWithDays,
      preferredLongRunDay: 1, // Monday — NOT in [Tue, Thu, Sat, Sun]
    });
    for (const week of plan.weeks) {
      if (week.type === "race") continue;
      const longRun = week.workouts.find((w) => w.type === "long");
      // Latest Mon-first day of the set is Sunday (0)
      expect(longRun?.dayOfWeek).toBe(0);
    }
  });

  it("still generates 7 workout slots per week (rest days fill the gaps)", () => {
    const plan = generatePlan(configWithDays);
    for (const week of plan.weeks) {
      expect(week.workouts).toHaveLength(7);
    }
  });

  it("keeps legacy derived-pattern behavior when availableDays is absent", () => {
    const withoutDays = generatePlan(marathonConfig);
    const withNull = generatePlan({ ...marathonConfig, availableDays: null });
    const daysA = withoutDays.weeks[2].workouts.filter((w) => w.type !== "rest").map((w) => w.dayOfWeek);
    const daysB = withNull.weeks[2].workouts.filter((w) => w.type !== "rest").map((w) => w.dayOfWeek);
    expect(daysB).toEqual(daysA);
  });

  it("echoes normalized availableDays and runnerLevel on the generated plan", () => {
    const plan = generatePlan({ ...configWithDays, runnerLevel: "intermediate" });
    expect(plan.availableDays).toEqual([2, 4, 6, 0]); // Monday-first order
    expect(plan.runnerLevel).toBe("intermediate");
  });

  it("supports a 2-day week with explicit days", () => {
    const plan = generatePlan({
      ...marathonConfig,
      daysPerWeek: 2,
      preferredLongRunDay: 6,
      availableDays: [3, 6],
    });
    const allowed = new Set([3, 6]);
    for (const week of plan.weeks) {
      if (week.type === "race") continue;
      for (const workout of week.workouts) {
        if (workout.type === "rest") continue;
        expect(allowed.has(workout.dayOfWeek)).toBe(true);
      }
      const longRun = week.workouts.find((w) => w.type === "long");
      expect(longRun?.dayOfWeek).toBe(6);
    }
  });
});

// ── Week number ordering ─────────────────────────────────────────────────────

describe("generatePlan — week numbering", () => {
  it("week numbers start at 1 and are sequential", () => {
    const plan = generatePlan(marathonConfig);
    for (let i = 0; i < plan.weeks.length; i++) {
      expect(plan.weeks[i].weekNumber).toBe(i + 1);
    }
  });
});

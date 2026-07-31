import { describe, expect, it } from "vitest";
import {
  suggestProgression,
  evaluatePainGate,
  applyPainGate,
  evaluateComplaintPainGates,
} from "../progression";
import type { ExerciseDef, ExerciseSessionHistory } from "../types";

const squat: ExerciseDef = {
  slug: "db_squat",
  name: "Dumbbell squat",
  category: "lower",
  repLow: 8,
  repHigh: 12,
  startWeightKg: 12.5,
};

const ohp: ExerciseDef = {
  slug: "overhead_press",
  name: "Standing overhead press",
  category: "upper",
  repLow: 8,
  repHigh: 12,
  slowProgressor: true,
  startWeightKg: 7.5,
};

function session(date: string, reps: number[], weightKg: number): ExerciseSessionHistory {
  return {
    sessionId: date,
    date: new Date(date),
    sets: reps.map((r, i) => ({ setNumber: i + 1, reps: r, weightKg })),
  };
}

describe("suggestProgression", () => {
  it("starts at the prescribed (snapped) weight with no history", () => {
    const s = suggestProgression(squat, []);
    expect(s.action).toBe("hold");
    expect(s.suggestedWeightKg).toBe(12.5); // 12.5 is a real stop now
  });

  it("increases one level when all sets hit the top of the range", () => {
    const s = suggestProgression(squat, [session("2026-06-10", [12, 12, 12], 12)]);
    expect(s.action).toBe("increase");
    expect(s.suggestedWeightKg).toBe(12.5); // +0.5 kg from 12
  });

  it("holds when reps are mid-range", () => {
    const s = suggestProgression(squat, [session("2026-06-10", [10, 9, 8], 12)]);
    expect(s.action).toBe("hold");
    expect(s.suggestedWeightKg).toBe(12);
  });

  it("deloads after two consecutive sub-floor sessions", () => {
    const s = suggestProgression(squat, [
      session("2026-06-12", [7, 6, 6], 13),
      session("2026-06-10", [7, 8, 8], 13),
    ]);
    expect(s.action).toBe("decrease");
    expect(s.suggestedWeightKg).toBe(12.5); // -0.5 kg from 13
  });

  it("does not deload on a single bad session", () => {
    const s = suggestProgression(squat, [
      session("2026-06-12", [7, 6, 6], 13),
      session("2026-06-10", [12, 12, 12], 13),
    ]);
    expect(s.action).not.toBe("decrease");
  });

  it("holds a slow progressor until two clean sessions in a row", () => {
    const oneClean = suggestProgression(ohp, [
      session("2026-06-12", [12, 12, 12], 8),
      session("2026-06-10", [10, 10, 9], 8),
    ]);
    expect(oneClean.action).toBe("hold");

    const twoClean = suggestProgression(ohp, [
      session("2026-06-12", [12, 12, 12], 8),
      session("2026-06-10", [12, 12, 12], 8),
    ]);
    expect(twoClean.action).toBe("increase");
    expect(twoClean.suggestedWeightKg).toBe(8.5);
  });

  it("holds at the ceiling instead of increasing past it", () => {
    const s = suggestProgression(squat, [session("2026-06-10", [12, 12, 12], 50)]);
    expect(s.action).toBe("hold");
    expect(s.atCeiling).toBe(true);
  });
});

describe("pain gate", () => {
  it("triggers above the score threshold", () => {
    const g = evaluatePainGate([{ score: 5, timing: "after" }]);
    expect(g.triggered).toBe(true);
  });

  it("does not trigger at or below the threshold", () => {
    expect(evaluatePainGate([{ score: 4, timing: "after" }]).triggered).toBe(false);
  });

  it("triggers when next-day load did not settle", () => {
    const g = evaluatePainGate([{ score: 2, timing: "next_day", settledWithin24h: false }]);
    expect(g.triggered).toBe(true);
  });

  it("caps a calf suggestion to one level down when gated (never increases)", () => {
    const base = suggestProgression(
      { ...squat, slug: "straight_knee_calf_raise", category: "achilles" },
      [session("2026-06-10", [12, 12, 12], 16)]
    );
    expect(base.action).toBe("increase");
    const gated = applyPainGate(base, { triggered: true, reason: "pain" });
    expect(gated.action).toBe("decrease");
    expect(gated.suggestedWeightKg).toBe(15.5); // -0.5 kg from 16
  });
});

describe("evaluateComplaintPainGates", () => {
  it("triggers a complaint whose own session logged a high pain score", () => {
    const gates = evaluateComplaintPainGates([
      { score: 6, timing: "during", complaints: ["knee"] },
    ]);
    expect(gates.knee?.triggered).toBe(true);
    expect(gates.knee?.reason).toContain("knee");
  });

  it("never triggers a complaint whose own logs stayed under the threshold", () => {
    const gates = evaluateComplaintPainGates([
      { score: 2, timing: "after", complaints: ["knee"] },
    ]);
    expect(gates.knee).toBeUndefined();
  });

  it("a log with no complaints on its session triggers nothing", () => {
    const gates = evaluateComplaintPainGates([
      { score: 8, timing: "during", complaints: [] },
    ]);
    expect(Object.keys(gates)).toHaveLength(0);
  });

  it("only triggers the complaint(s) actually reported for that log's session", () => {
    const gates = evaluateComplaintPainGates([
      { score: 6, timing: "during", complaints: ["knee"] },
    ]);
    expect(gates.knee?.triggered).toBe(true);
    expect(gates.hamstring).toBeUndefined();
    expect(gates.itb).toBeUndefined();
  });

  it("excludes achilles — that complaint keeps evaluatePainGate/getPainGate instead", () => {
    const gates = evaluateComplaintPainGates([
      { score: 9, timing: "during", complaints: ["achilles"] },
    ]);
    expect(Object.keys(gates)).toHaveLength(0);
  });

  it("triggers on a next-day check-in that didn't settle, same as the global gate", () => {
    const gates = evaluateComplaintPainGates([
      { score: 1, timing: "next_day", settledWithin24h: false, complaints: ["hamstring"] },
    ]);
    expect(gates.hamstring?.triggered).toBe(true);
  });
});

describe("warm-up sets are excluded from the progression signal", () => {
  /** A session whose first set is a light warm-up ramp, then working sets. */
  function withWarmup(
    date: string,
    warmup: { reps: number; weightKg: number },
    working: number[],
    weightKg: number
  ): ExerciseSessionHistory {
    return {
      sessionId: date,
      date: new Date(date),
      sets: [
        { setNumber: 1, reps: warmup.reps, weightKg: warmup.weightKg, kind: "warmup" },
        ...working.map((r, i) => ({ setNumber: i + 2, reps: r, weightKg })),
      ],
    };
  }

  it("still increases when every WORKING set hits the top of the range", () => {
    // Before the fix the 5-rep warm-up made allSetsAtTop false, so an athlete
    // who warmed up could never earn an increase.
    const s = suggestProgression(squat, [
      withWarmup("2026-06-10", { reps: 5, weightKg: 6 }, [12, 12, 12], 12),
    ]);
    expect(s.action).toBe("increase");
  });

  it("does not suggest a decrease off the back of warm-ups alone", () => {
    // Two sessions of mid-range working sets, each preceded by a light ramp.
    // Before the fix the ramp counted as a set below the rep floor in both
    // sessions, which is exactly the decrease condition.
    const s = suggestProgression(squat, [
      withWarmup("2026-06-17", { reps: 5, weightKg: 6 }, [10, 10, 9], 12),
      withWarmup("2026-06-10", { reps: 5, weightKg: 6 }, [10, 9, 9], 12),
    ]);
    expect(s.action).not.toBe("decrease");
  });

  it("still decreases when the WORKING sets genuinely fall short", () => {
    const s = suggestProgression(squat, [
      withWarmup("2026-06-17", { reps: 5, weightKg: 6 }, [6, 5, 5], 12),
      withWarmup("2026-06-10", { reps: 5, weightKg: 6 }, [7, 6, 5], 12),
    ]);
    expect(s.action).toBe("decrease");
  });

  it("treats a set with no kind as working, so historical rows are unchanged", () => {
    const s = suggestProgression(squat, [session("2026-06-10", [12, 12, 12], 12)]);
    expect(s.action).toBe("increase");
  });

  it("ignores a warm-up when reading the top weight lifted", () => {
    // A heavy-looking warm-up must not be mistaken for the working load.
    const s = suggestProgression(squat, [
      withWarmup("2026-06-10", { reps: 5, weightKg: 20 }, [12, 12, 12], 12),
    ]);
    expect(s.suggestedWeightKg).toBe(12.5);
  });
});

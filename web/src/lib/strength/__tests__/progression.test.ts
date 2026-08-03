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
    const s = suggestProgression(squat, [], 8, 12);
    expect(s.action).toBe("hold");
    expect(s.suggestedWeightKg).toBe(12.5); // 12.5 is a real stop now
  });

  it("increases one level when all sets hit the top of the range", () => {
    const s = suggestProgression(squat, [session("2026-06-10", [12, 12, 12], 12)], 8, 12);
    expect(s.action).toBe("increase");
    expect(s.suggestedWeightKg).toBe(12.5); // +0.5 kg from 12
  });

  it("holds when reps are mid-range", () => {
    const s = suggestProgression(squat, [session("2026-06-10", [10, 9, 8], 12)], 8, 12);
    expect(s.action).toBe("hold");
    expect(s.suggestedWeightKg).toBe(12);
  });

  it("deloads after two consecutive sub-floor sessions", () => {
    const s = suggestProgression(squat, [
      session("2026-06-12", [7, 6, 6], 13),
      session("2026-06-10", [7, 8, 8], 13),
    ], 8, 12);
    expect(s.action).toBe("decrease");
    expect(s.suggestedWeightKg).toBe(12.5); // -0.5 kg from 13
  });

  it("does not deload on a single bad session", () => {
    const s = suggestProgression(squat, [
      session("2026-06-12", [7, 6, 6], 13),
      session("2026-06-10", [12, 12, 12], 13),
    ], 8, 12);
    expect(s.action).not.toBe("decrease");
  });

  it("holds a slow progressor until two clean sessions in a row", () => {
    const oneClean = suggestProgression(ohp, [
      session("2026-06-12", [12, 12, 12], 8),
      session("2026-06-10", [10, 10, 9], 8),
    ], 8, 12);
    expect(oneClean.action).toBe("hold");

    const twoClean = suggestProgression(ohp, [
      session("2026-06-12", [12, 12, 12], 8),
      session("2026-06-10", [12, 12, 12], 8),
    ], 8, 12);
    expect(twoClean.action).toBe("increase");
    expect(twoClean.suggestedWeightKg).toBe(8.5);
  });

  it("holds at the ceiling instead of increasing past it", () => {
    const s = suggestProgression(squat, [session("2026-06-10", [12, 12, 12], 50)], 8, 12);
    expect(s.action).toBe("hold");
    expect(s.atCeiling).toBe(true);
  });

  it("judges against the passed-in range, not the exercise's static range", () => {
    // Same history (6s, mid-range for the exercise's own 8-12), but the
    // caller passes a build-phase-style 4-6 range instead. 6 reps clears the
    // top of THAT range (and stays within the transition-guard slack of
    // both ranges, so this isn't the transition-guard case below), so this
    // must read as an increase — proof the repLow/repHigh parameters are
    // live inputs, not decorative pass-through of exercise.repLow/repHigh.
    const staticRange = suggestProgression(
      squat,
      [session("2026-06-10", [6, 6, 6], 12)],
      8,
      12
    );
    expect(staticRange.action).toBe("hold");

    const passedRange = suggestProgression(
      squat,
      [session("2026-06-10", [6, 6, 6], 12)],
      4,
      6
    );
    expect(passedRange.action).toBe("increase");
  });
});

describe("phase-transition guard", () => {
  it("holds on a base→build style jump (last session logged well outside the new range)", () => {
    // history[0] was logged at 10-12 reps (a base-phase session); the caller
    // now judges it against a build-phase 4-6 range. Every rep is more than
    // TRANSITION_GUARD_SLACK (2) above repHigh (6), so this reads as a
    // phase-transition session rather than a genuine top-of-range pass.
    const s = suggestProgression(squat, [session("2026-06-10", [10, 11, 12], 12)], 4, 6);
    expect(s.action).toBe("hold");
    expect(s.reason).toMatch(/new rep range/i);
  });

  it("holds on a build→base style jump the other direction", () => {
    // history[0] was logged at 4-6 reps; judged against a base-phase 10-12
    // range every rep is more than 2 below repLow (10), so the guard trips
    // the same way in reverse rather than reading it as an anySetBelowFloor
    // deload signal.
    const s = suggestProgression(squat, [session("2026-06-10", [4, 5, 6], 12)], 10, 12);
    expect(s.action).toBe("hold");
    expect(s.reason).toMatch(/new rep range/i);
  });

  it("still progresses normally when the session was logged against the same range", () => {
    // Same range as before, reps genuinely at the top — ordinary progression,
    // not a transition.
    const s = suggestProgression(squat, [session("2026-06-10", [12, 12, 12], 12)], 8, 12);
    expect(s.action).toBe("increase");
  });

  it("does not trip on reps just outside the range by less than the slack", () => {
    // 7 reps against a 8-12 range is only 1 below repLow — ordinary variance,
    // not a transition — so the ordinary deload rule (needs two consecutive
    // sub-floor sessions) still governs.
    const s = suggestProgression(
      squat,
      [
        session("2026-06-17", [7, 7, 7], 12),
        session("2026-06-10", [7, 7, 7], 12),
      ],
      8,
      12
    );
    expect(s.action).toBe("decrease");
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
      [session("2026-06-10", [12, 12, 12], 16)],
      8,
      12
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
    ], 8, 12);
    expect(s.action).toBe("increase");
  });

  it("does not suggest a decrease off the back of warm-ups alone", () => {
    // Two sessions of mid-range working sets, each preceded by a light ramp.
    // Before the fix the ramp counted as a set below the rep floor in both
    // sessions, which is exactly the decrease condition.
    const s = suggestProgression(squat, [
      withWarmup("2026-06-17", { reps: 5, weightKg: 6 }, [10, 10, 9], 12),
      withWarmup("2026-06-10", { reps: 5, weightKg: 6 }, [10, 9, 9], 12),
    ], 8, 12);
    expect(s.action).not.toBe("decrease");
  });

  it("still decreases when the WORKING sets genuinely fall short", () => {
    const s = suggestProgression(squat, [
      withWarmup("2026-06-17", { reps: 5, weightKg: 6 }, [6, 5, 5], 12),
      withWarmup("2026-06-10", { reps: 5, weightKg: 6 }, [7, 6, 5], 12),
    ], 8, 12);
    expect(s.action).toBe("decrease");
  });

  it("treats a set with no kind as working, so historical rows are unchanged", () => {
    const s = suggestProgression(squat, [session("2026-06-10", [12, 12, 12], 12)], 8, 12);
    expect(s.action).toBe("increase");
  });

  it("ignores a warm-up when reading the top weight lifted", () => {
    // A heavy-looking warm-up must not be mistaken for the working load.
    const s = suggestProgression(squat, [
      withWarmup("2026-06-10", { reps: 5, weightKg: 20 }, [12, 12, 12], 12),
    ], 8, 12);
    expect(s.suggestedWeightKg).toBe(12.5);
  });
});

describe("extra sets and cut-short sessions", () => {
  /** A session with mid-range prescribed sets, plus one or more extra sets
   *  logged beyond the prescription (kind "extra" — see guided-sets.ts). */
  function withExtra(
    date: string,
    working: number[],
    extraReps: number[],
    weightKg: number
  ): ExerciseSessionHistory {
    return {
      sessionId: date,
      date: new Date(date),
      sets: [
        ...working.map((r, i) => ({ setNumber: i + 1, reps: r, weightKg })),
        ...extraReps.map((r, i) => ({
          setNumber: working.length + i + 1,
          reps: r,
          weightKg,
          kind: "extra" as const,
        })),
      ],
    };
  }

  /** A session with a skipped prescribed set (kind "skipped", no reps/weight
   *  — see db/schema.ts strengthSets.kind), optionally with a cut-short
   *  reason on the session it belongs to. */
  function withSkip(
    date: string,
    working: number[],
    weightKg: number,
    cutShortReason?: "time" | "fatigue" | null
  ): ExerciseSessionHistory {
    return {
      sessionId: date,
      date: new Date(date),
      sets: [
        ...working.map((r, i) => ({ setNumber: i + 1, reps: r, weightKg })),
        { setNumber: working.length + 1, reps: null, weightKg: null, kind: "skipped" as const },
      ],
      cutShortReason,
    };
  }

  it("extra sets that hit the top of the range make an increase more likely", () => {
    // Prescribed sets alone are mid-range (would hold), but the athlete
    // tacked on an extra set at the rep ceiling — capacity evidence.
    const s = suggestProgression(squat, [withExtra("2026-06-10", [10, 9, 9], [12], 12)], 8, 12);
    expect(s.action).toBe("increase");
    expect(s.suggestedWeightKg).toBe(12.5);
  });

  it("does not increase off an extra set that didn't reach the top of the range", () => {
    const s = suggestProgression(squat, [withExtra("2026-06-10", [10, 9, 9], [9], 12)], 8, 12);
    expect(s.action).toBe("hold");
  });

  it("a time cut-short does not suppress the next increase", () => {
    // Only 2 of 3 prescribed sets logged, both at the rep ceiling — the
    // missing third set must not count against the athlete.
    const s = suggestProgression(squat, [withSkip("2026-06-10", [12, 12], 12, "time")], 8, 12);
    expect(s.action).toBe("increase");
  });

  it("no answer behaves like time — never penalised", () => {
    const s = suggestProgression(squat, [withSkip("2026-06-10", [12, 12], 12, null)], 8, 12);
    expect(s.action).toBe("increase");
  });

  it("a fatigue cut-short holds rather than increases", () => {
    const s = suggestProgression(squat, [withSkip("2026-06-10", [12, 12], 12, "fatigue")], 8, 12);
    expect(s.action).toBe("hold");
    expect(s.suggestedWeightKg).toBe(12); // held, not dropped
  });

  it("a fatigue cut-short is per exercise, not per session", () => {
    // cutShortReason lives on the exercise's OWN history entry (see
    // service.ts getExerciseHistoryBySlug: only an exercise with its own
    // "skipped" row in a session gets that session's answer attached). A
    // different exercise from the same cut-short session, with no
    // cutShortReason on its own history, is unaffected — same history shape
    // that squat's fatigue case above uses, just without the skip.
    const unaffected = suggestProgression(ohp, [
      session("2026-06-10", [12, 12, 12], 8),
      session("2026-06-03", [12, 12, 12], 8),
    ], 8, 12);
    expect(unaffected.action).toBe("increase");
  });

  it("an old fatigue signal decays behind a newer clean session", () => {
    // The rushed session is now `prev`, not `last` — only the latest session
    // gates the suggestion, so two solid weeks outweigh one rushed one.
    const s = suggestProgression(squat, [
      session("2026-06-17", [12, 12, 12], 12),
      withSkip("2026-06-10", [12, 12], 12, "fatigue"),
    ], 8, 12);
    expect(s.action).toBe("increase");
  });

  it("warm-ups still never count toward extra-set capacity evidence", () => {
    const s = suggestProgression(squat, [
      {
        sessionId: "2026-06-10",
        date: new Date("2026-06-10"),
        sets: [
          { setNumber: 1, reps: 12, weightKg: 6, kind: "warmup" },
          { setNumber: 2, reps: 10, weightKg: 12 },
          { setNumber: 3, reps: 9, weightKg: 12 },
          { setNumber: 4, reps: 9, weightKg: 12 },
        ],
      },
    ], 8, 12);
    expect(s.action).toBe("hold");
  });
});

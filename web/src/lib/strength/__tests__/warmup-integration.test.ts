import { describe, expect, it } from "vitest";
import { deriveWarmupRamp } from "../warmup";
import { suggestProgression } from "../progression";
import { computeSessionMetrics, isNewSingleSetRecord, type PrSet } from "../pr";
import type { ExerciseDef, ExerciseSessionHistory } from "../types";

// ── End-to-end: a pre-tagged ramp set must never pollute the progression or
// PR signal ───────────────────────────────────────────────────────────────
//
// Walks the real path a guided session takes: derive a ramp from the working
// weight (as GuidedSession.tsx's buildWork does), then feed BOTH the ramp
// set and the real working sets through progression.ts and pr.ts exactly as
// the server does. Regression coverage for the bug fixed alongside this
// feature (an untagged warm-up used to invert progression) and for the new
// path this task adds (a pre-tagged ramp set flowing through for the first
// time).

const squat: ExerciseDef = {
  slug: "db_squat",
  name: "Dumbbell squat",
  category: "lower",
  repLow: 8,
  repHigh: 12,
  startWeightKg: 12.5,
};

describe("warm-up ramp end to end", () => {
  it("a pre-tagged ramp set does not block a progression increase", () => {
    const workingWeightKg = 20; // two-step ramp: 10kg, 15kg
    const ramp = deriveWarmupRamp("primary", workingWeightKg);
    expect(ramp.length).toBeGreaterThan(0);

    // Every ramp set is well under repHigh (12) — if it were miscounted as a
    // working set, allSetsAtTop would never fire and the increase would be
    // lost.
    const session: ExerciseSessionHistory = {
      sessionId: "s1",
      date: new Date("2026-01-01"),
      sets: [
        ...ramp.map((r, i) => ({
          setNumber: i + 1,
          weightKg: r.kg,
          reps: r.reps,
          kind: "warmup" as const,
        })),
        // Three real working sets, all at the top of the range.
        { setNumber: ramp.length + 1, weightKg: workingWeightKg, reps: 12, kind: "working" as const },
        { setNumber: ramp.length + 2, weightKg: workingWeightKg, reps: 12, kind: "working" as const },
        { setNumber: ramp.length + 3, weightKg: workingWeightKg, reps: 12, kind: "working" as const },
      ],
    };

    const suggestion = suggestProgression(squat, [session], 8, 12);
    expect(suggestion.action).toBe("increase");
  });

  it("a pre-tagged ramp set does not trigger a false deload", () => {
    // The ramp is intentionally light and low-rep relative to repLow (8) —
    // if counted as working, two sessions of ramp-only-below-floor sets
    // would suggest a decrease even though the real working sets are fine.
    const workingWeightKg = 15;
    const ramp = deriveWarmupRamp("primary", workingWeightKg);

    function session(id: string, date: string): ExerciseSessionHistory {
      return {
        sessionId: id,
        date: new Date(date),
        sets: [
          ...ramp.map((r, i) => ({
            setNumber: i + 1,
            weightKg: r.kg,
            reps: r.reps, // RAMP_REPS (6) — below repLow (8) if miscounted
            kind: "warmup" as const,
          })),
          { setNumber: ramp.length + 1, weightKg: workingWeightKg, reps: 10, kind: "working" as const },
          { setNumber: ramp.length + 2, weightKg: workingWeightKg, reps: 9, kind: "working" as const },
        ],
      };
    }

    const suggestion = suggestProgression(squat, [
      session("s2", "2026-01-08"),
      session("s1", "2026-01-01"),
    ], 8, 12);
    expect(suggestion.action).not.toBe("decrease");
    expect(suggestion.action).toBe("hold");
  });

  it("a heavier ramp set never wins the heaviest-set PR over the real working set", () => {
    const workingWeightKg = 20;
    const ramp = deriveWarmupRamp("primary", workingWeightKg);
    // Ramp sets are always lighter than the working weight by construction,
    // but confirm the PR module also can't be fooled if a ramp set were
    // ever logged heavier (e.g. a hand-edited weight).
    const heavyMisloggedRamp: PrSet = { weightKg: 999, reps: 5, setType: "warmup" };
    const workingSet: PrSet = { weightKg: workingWeightKg, reps: 10, setType: "working" };

    const metrics = computeSessionMetrics(
      [heavyMisloggedRamp, workingSet, ...ramp.map((r) => ({ weightKg: r.kg, reps: r.reps, setType: "warmup" as const }))],
      "s1",
      new Date(),
      { bodyweight: false }
    );
    expect(metrics.topWeightKg).toBe(workingWeightKg);
  });

  it("a ramp set logged before the real working set does not register a live PR", () => {
    const workingWeightKg = 20;
    const ramp = deriveWarmupRamp("primary", workingWeightKg);
    const rampSet: PrSet = { weightKg: ramp[0].kg, reps: ramp[0].reps, setType: "warmup" };
    // No prior history — an untagged set would trivially be "the first ever
    // logged" and register as a PR. A ramp set must not, even with an empty
    // history to compare against.
    const result = isNewSingleSetRecord(rampSet, [], { bodyweight: false });
    expect(result).toEqual({ weight: false, e1rm: false });
  });
});

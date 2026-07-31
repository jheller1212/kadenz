import { describe, expect, it } from "vitest";
import { sessionVolume, profileForSlug } from "../volume";

// Real catalogue slugs (see program.ts): "overhead_press" is a standard
// two-dumbbell lift, "single_leg_rdl" is single-dumbbell, "push_up" is
// bodyweight with no startWeightKg at all.

describe("profileForSlug", () => {
  it("reads a standard lift as two-dumbbell, loaded", () => {
    expect(profileForSlug("overhead_press")).toEqual({ bodyweight: false, dumbbells: undefined });
  });

  it("reads a single-dumbbell lift's dumbbell count from the catalogue", () => {
    expect(profileForSlug("single_leg_rdl")).toEqual({ bodyweight: false, dumbbells: 1 });
  });

  it("reads an exercise with no startWeightKg as bodyweight", () => {
    expect(profileForSlug("push_up")).toEqual({ bodyweight: true, dumbbells: undefined });
  });
});

describe("sessionVolume", () => {
  it("doubles a two-dumbbell lift's per-hand weight (weightKg is stored per dumbbell)", () => {
    const v = sessionVolume([
      { exerciseSlug: "overhead_press", weightKg: 10, reps: 10, kind: "working" },
      { exerciseSlug: "overhead_press", weightKg: 10, reps: 10, kind: "working" },
      { exerciseSlug: "overhead_press", weightKg: 10, reps: 10, kind: "working" },
    ]);
    // 10kg per hand × 10 reps × 2 hands × 3 sets = 600kg, not 300kg.
    expect(v.kg).toBe(600);
    expect(v.bodyweightReps).toBeNull();
  });

  it("does not double a single-dumbbell lift", () => {
    const v = sessionVolume([
      { exerciseSlug: "single_leg_rdl", weightKg: 15, reps: 8, kind: "working" },
    ]);
    expect(v.kg).toBe(120);
  });

  it("counts a bodyweight exercise's reps instead of silently contributing zero", () => {
    const v = sessionVolume([
      { exerciseSlug: "push_up", weightKg: null, reps: 12, kind: "working" },
      { exerciseSlug: "push_up", weightKg: null, reps: 10, kind: "working" },
    ]);
    expect(v.kg).toBeNull();
    expect(v.bodyweightReps).toBe(22);
  });

  it("reports kg and bodyweight reps separately when a session mixes both", () => {
    const v = sessionVolume([
      { exerciseSlug: "overhead_press", weightKg: 10, reps: 10, kind: "working" },
      { exerciseSlug: "push_up", weightKg: null, reps: 15, kind: "working" },
    ]);
    expect(v.kg).toBe(200);
    expect(v.bodyweightReps).toBe(15);
  });

  it("excludes warm-up sets from both totals", () => {
    const v = sessionVolume([
      { exerciseSlug: "overhead_press", weightKg: 5, reps: 15, kind: "warmup" },
      { exerciseSlug: "overhead_press", weightKg: 10, reps: 10, kind: "working" },
      { exerciseSlug: "push_up", weightKg: null, reps: 20, kind: "warmup" },
    ]);
    expect(v.kg).toBe(200);
    expect(v.bodyweightReps).toBeNull();
  });

  it("treats a null/missing kind as working (pre-warm-up-feature rows)", () => {
    const v = sessionVolume([{ exerciseSlug: "overhead_press", weightKg: 10, reps: 10, kind: null }]);
    expect(v.kg).toBe(200);
  });

  // toggleSetKind (GuidedSession.tsx) only ever flips this field — same
  // shape either way, nothing else about the set changes. Confirms the flip
  // is symmetric: marking a set as a warm-up excludes it, and unmarking it
  // (flipping "warmup" back to "working") restores it to volume in full.
  it("unmarking a warm-up set restores it to volume", () => {
    const markedWarmup = sessionVolume([
      { exerciseSlug: "overhead_press", weightKg: 10, reps: 10, kind: "warmup" },
      { exerciseSlug: "overhead_press", weightKg: 10, reps: 10, kind: "working" },
    ]);
    const unmarked = sessionVolume([
      { exerciseSlug: "overhead_press", weightKg: 10, reps: 10, kind: "working" },
      { exerciseSlug: "overhead_press", weightKg: 10, reps: 10, kind: "working" },
    ]);
    expect(markedWarmup.kg).toBe(200); // one set counted
    expect(unmarked.kg).toBe(400); // both sets counted once unmarked
  });
});

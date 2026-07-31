import { describe, expect, it } from "vitest";
import { findExchangeCandidates } from "../exchange";

describe("findExchangeCandidates", () => {
  // db_squat is primaryMuscle "Quads" (category "lower"), so its candidate
  // pool prefers other quad exercises first (see exchange.ts's sameMuscle
  // fallback) — bulgarian_split_squat (needs dumbbell+chair) and wall_sit
  // (bodyweight, equipment: []) are both quad work in that same pool.
  it("is unfiltered when equipment is null (no plan settings configured yet)", () => {
    const candidates = findExchangeCandidates("db_squat", [], null);
    expect(candidates.some((c) => c.slug === "bulgarian_split_squat")).toBe(true);
    expect(candidates.some((c) => c.slug === "wall_sit")).toBe(true);
  });

  // The pre-start sheet's "gym today" choice (a per-session equipment
  // override) must narrow Exchange the same way the athlete's usual
  // equipment does — a dumbbell-only alternative is not a fair swap on a
  // day the athlete said they only have bodyweight.
  it("respects a bodyweight-only session equipment override, excluding dumbbell alternatives", () => {
    const candidates = findExchangeCandidates("db_squat", [], []);
    expect(candidates.some((c) => c.slug === "bulgarian_split_squat")).toBe(false);
    expect(candidates.some((c) => c.slug === "wall_sit")).toBe(true);
  });

  it("offers the dumbbell alternative back once the override includes dumbbells and a chair", () => {
    const candidates = findExchangeCandidates("db_squat", [], ["dumbbell", "chair"]);
    expect(candidates.some((c) => c.slug === "bulgarian_split_squat")).toBe(true);
  });

  it("never offers or replaces Achilles-role work", () => {
    expect(findExchangeCandidates("explosive_box_step_up", [], null)).toEqual([]);
    const candidates = findExchangeCandidates("db_squat", [], null);
    expect(candidates.some((c) => c.slug === "explosive_box_step_up")).toBe(false);
  });

  it("excludes exercises already in the session", () => {
    const candidates = findExchangeCandidates("db_squat", ["wall_sit"], null);
    expect(candidates.some((c) => c.slug === "wall_sit")).toBe(false);
    expect(candidates.some((c) => c.slug === "bulgarian_split_squat")).toBe(true);
  });
});

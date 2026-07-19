import { describe, expect, it } from "vitest";
import { deriveStartWeightKg } from "../load-model";
import { DUMBBELL_LEVELS_KG } from "../weights";
import { EXERCISE_BY_SLUG } from "../program";

const gobletSquat = EXERCISE_BY_SLUG["goblet_squat"];
const row = EXERCISE_BY_SLUG["one_arm_row"];
const press = EXERCISE_BY_SLUG["overhead_press"];
const bodyweightOnly = EXERCISE_BY_SLUG["single_leg_hip_thrust"];

function isOnLadder(kg: number): boolean {
  return DUMBBELL_LEVELS_KG.some((l) => Math.abs(l - kg) < 1e-9);
}

describe("deriveStartWeightKg", () => {
  it("gives a 75 kg male novice a materially heavier goblet squat than the 8 kg global default", () => {
    const kg = deriveStartWeightKg(gobletSquat, {
      bodyweightKg: 75,
      sex: "male",
      experience: "beginner",
    });
    expect(kg).toBeGreaterThan(8);
    expect(kg).toBeDefined();
    expect(isOnLadder(kg as number)).toBe(true);
  });

  it("gives a 75 kg male novice a heavier goblet squat than a 55 kg female novice", () => {
    const male = deriveStartWeightKg(gobletSquat, {
      bodyweightKg: 75,
      sex: "male",
      experience: "beginner",
    })!;
    const female = deriveStartWeightKg(gobletSquat, {
      bodyweightKg: 55,
      sex: "female",
      experience: "beginner",
    })!;
    expect(male).toBeGreaterThan(female);
  });

  it("experienced lifters get a heavier load than novices, all else equal", () => {
    const novice = deriveStartWeightKg(gobletSquat, {
      bodyweightKg: 75,
      sex: "male",
      experience: "beginner",
    })!;
    const some = deriveStartWeightKg(gobletSquat, {
      bodyweightKg: 75,
      sex: "male",
      experience: "intermediate",
    })!;
    const experienced = deriveStartWeightKg(gobletSquat, {
      bodyweightKg: 75,
      sex: "male",
      experience: "advanced",
    })!;
    expect(some).toBeGreaterThan(novice);
    expect(experienced).toBeGreaterThan(some);
  });

  it("always lands on a real dumbbell ladder step", () => {
    for (const bodyweightKg of [45, 55, 62.3, 75, 91, 120]) {
      for (const sex of ["male", "female", "unspecified"] as const) {
        for (const experience of ["beginner", "intermediate", "advanced"] as const) {
          const kg = deriveStartWeightKg(gobletSquat, { bodyweightKg, sex, experience });
          expect(kg).toBeDefined();
          expect(isOnLadder(kg as number)).toBe(true);
        }
      }
    }
  });

  it("never invents a load for bodyweight-only exercises", () => {
    expect(bodyweightOnly.startWeightKg).toBeUndefined();
    const kg = deriveStartWeightKg(bodyweightOnly, {
      bodyweightKg: 75,
      sex: "male",
      experience: "advanced",
    });
    expect(kg).toBeUndefined();
  });

  it("falls back to today's global constant exactly when bodyweight is missing", () => {
    expect(deriveStartWeightKg(gobletSquat, null)).toBe(8);
    expect(deriveStartWeightKg(gobletSquat, {})).toBe(8);
    expect(deriveStartWeightKg(gobletSquat, { sex: "male", experience: "advanced" })).toBe(8);
    expect(deriveStartWeightKg(row, undefined)).toBe(10);
    expect(deriveStartWeightKg(press, { bodyweightKg: 0 })).toBe(7.5);
  });

  it("row and press personalise too, snapped to the ladder", () => {
    const profile = { bodyweightKg: 75, sex: "male" as const, experience: "beginner" as const };
    const rowKg = deriveStartWeightKg(row, profile)!;
    const pressKg = deriveStartWeightKg(press, profile)!;
    expect(isOnLadder(rowKg)).toBe(true);
    expect(isOnLadder(pressKg)).toBe(true);
    expect(rowKg).toBeGreaterThan(0);
    expect(pressKg).toBeGreaterThan(0);
  });
});

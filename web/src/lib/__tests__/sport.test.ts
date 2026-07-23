import { describe, it, expect } from "vitest";
import { sportBucket } from "../sport";

describe("sportBucket", () => {
  it("treats a linked strength session as strength regardless of sport_type", () => {
    expect(sportBucket("Run", true)).toBe("strength");
    expect(sportBucket(null, true)).toBe("strength");
  });

  it("buckets running variants", () => {
    expect(sportBucket("Run", false)).toBe("run");
    expect(sportBucket("TrailRun", false)).toBe("run");
    expect(sportBucket("VirtualRun", false)).toBe("run");
    expect(sportBucket("TreadmillRunning", false)).toBe("run");
  });

  it("buckets cycling variants", () => {
    expect(sportBucket("Ride", false)).toBe("ride");
    expect(sportBucket("VirtualRide", false)).toBe("ride");
    expect(sportBucket("MountainBikeRide", false)).toBe("ride");
    expect(sportBucket("cycling", false)).toBe("ride");
  });

  it("buckets swimming", () => {
    expect(sportBucket("Swim", false)).toBe("swim");
    expect(sportBucket("OpenWaterSwim", false)).toBe("swim");
  });

  it("buckets strength sport types without a session link", () => {
    expect(sportBucket("WeightTraining", false)).toBe("strength");
    expect(sportBucket("Workout", false)).toBe("strength");
    expect(sportBucket("Crossfit", false)).toBe("strength");
    expect(sportBucket("HIIT", false)).toBe("strength");
  });

  it("defaults null/empty to run (running-first)", () => {
    expect(sportBucket(null, false)).toBe("run");
    expect(sportBucket("", false)).toBe("run");
  });

  it("falls back to other for unrelated sports", () => {
    expect(sportBucket("Yoga", false)).toBe("other");
    expect(sportBucket("Hike", false)).toBe("other");
  });
});

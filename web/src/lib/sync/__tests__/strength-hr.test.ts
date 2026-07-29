import { describe, expect, it } from "vitest";
import { alignSetHeartRate, type HeartRateStream } from "../strength-hr";

const ACTIVITY_START = new Date("2026-07-20T18:00:00Z");

// One heartrate sample per 10 elapsed seconds, ramping from 100 to 160 bpm.
const STREAM: HeartRateStream = {
  time: Array.from({ length: 30 }, (_, i) => i * 10), // 0..290s
  heartrate: Array.from({ length: 30 }, (_, i) => 100 + i * 2),
};

describe("alignSetHeartRate", () => {
  it("averages samples in [createdAt - durationSeconds, createdAt] when duration is known", () => {
    // Set logged at elapsed 100s, time-under-load 30s -> window [70s, 100s].
    const set = {
      createdAt: new Date(ACTIVITY_START.getTime() + 100_000),
      durationSeconds: 30,
    };
    const result = alignSetHeartRate(ACTIVITY_START, STREAM, set);
    // Samples at t=70,80,90,100 -> hr 114,116,118,120.
    expect(result.avgHr).toBe(Math.round((114 + 116 + 118 + 120) / 4));
    expect(result.maxHr).toBe(120);
  });

  it("falls back to a fixed window when duration_seconds is null", () => {
    const set = { createdAt: new Date(ACTIVITY_START.getTime() + 100_000), durationSeconds: null };
    const result = alignSetHeartRate(ACTIVITY_START, STREAM, set);
    // Fallback window is 30s, same as the explicit-duration case above.
    expect(result.avgHr).toBe(Math.round((114 + 116 + 118 + 120) / 4));
  });

  it("returns null, not zero, when the activity has no heart-rate stream", () => {
    const set = { createdAt: new Date(ACTIVITY_START.getTime() + 100_000), durationSeconds: 30 };
    expect(alignSetHeartRate(ACTIVITY_START, null, set)).toEqual({ avgHr: null, maxHr: null });
  });

  it("returns null for a set logged outside the activity's recorded window", () => {
    // Stream only covers 0..290s; this set was logged an hour after start.
    const set = { createdAt: new Date(ACTIVITY_START.getTime() + 3_600_000), durationSeconds: 30 };
    expect(alignSetHeartRate(ACTIVITY_START, STREAM, set)).toEqual({ avgHr: null, maxHr: null });
  });

  it("returns null for a set logged before the activity started", () => {
    const set = { createdAt: new Date(ACTIVITY_START.getTime() - 60_000), durationSeconds: 30 };
    expect(alignSetHeartRate(ACTIVITY_START, STREAM, set)).toEqual({ avgHr: null, maxHr: null });
  });
});

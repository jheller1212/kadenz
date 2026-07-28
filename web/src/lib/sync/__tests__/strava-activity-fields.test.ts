import { describe, it, expect } from "vitest";
import {
  isRunActivity,
  isStrengthActivity,
  commonStravaFields,
  runStravaFields,
  stravaUpdateFields,
  type StravaActivity,
} from "../strava-activity-fields";

function baseActivity(overrides: Partial<StravaActivity> = {}): StravaActivity {
  return {
    id: 555,
    name: "Evening Run",
    type: "Run",
    sport_type: "Run",
    distance: 10000, // 10 km
    moving_time: 3000,
    elapsed_time: 3050,
    start_date: "2026-07-20T17:00:00Z",
    start_date_local: "2026-07-20T19:00:00Z",
    average_speed: 3.3333, // ~5:00/km
    max_speed: 4.0,
    ...overrides,
  };
}

describe("isRunActivity / isStrengthActivity", () => {
  it("classifies a Run", () => {
    const a = baseActivity();
    expect(isRunActivity(a)).toBe(true);
    expect(isStrengthActivity(a)).toBe(false);
  });

  it("classifies WeightTraining as strength, not a run", () => {
    const a = baseActivity({ type: "WeightTraining", sport_type: "WeightTraining" });
    expect(isRunActivity(a)).toBe(false);
    expect(isStrengthActivity(a)).toBe(true);
  });

  it("classifies a Hike as neither", () => {
    const a = baseActivity({ type: "Hike", sport_type: "Hike" });
    expect(isRunActivity(a)).toBe(false);
    expect(isStrengthActivity(a)).toBe(false);
  });
});

describe("commonStravaFields", () => {
  it("carries the edited title through", () => {
    const a = baseActivity({ name: "Evening Run (fixed typo)" });
    expect(commonStravaFields(a).name).toBe("Evening Run (fixed typo)");
  });

  it("rounds heart rate and tolerates missing values", () => {
    const withHr = commonStravaFields(baseActivity({ average_heartrate: 151.6, max_heartrate: 178.4 }));
    expect(withHr.avgHr).toBe(152);
    expect(withHr.maxHr).toBe(178);

    const withoutHr = commonStravaFields(baseActivity());
    expect(withoutHr.avgHr).toBeNull();
    expect(withoutHr.maxHr).toBeNull();
  });
});

describe("runStravaFields", () => {
  it("converts distance to km and computes pace from average speed", () => {
    const fields = runStravaFields(baseActivity());
    expect(fields.distanceKm).toBeCloseTo(10);
    expect(fields.avgPaceSecKm).toBe(Math.round(1000 / 3.3333));
  });

  it("reflects a cropped activity's shorter distance/duration", () => {
    const cropped = baseActivity({ distance: 8000, moving_time: 2400, average_speed: 3.3333 });
    const fields = runStravaFields(cropped);
    expect(fields.distanceKm).toBeCloseTo(8);
  });
});

describe("stravaUpdateFields", () => {
  it("includes run-only fields (distance, pace, polyline, …) for a Run", () => {
    const fields = stravaUpdateFields(baseActivity());
    expect(fields).toHaveProperty("distanceKm");
    expect(fields).toHaveProperty("polyline");
  });

  it("omits run-only fields once the activity is reclassified away from Run", () => {
    const fields = stravaUpdateFields(baseActivity({ type: "Hike", sport_type: "Hike" }));
    expect(fields).not.toHaveProperty("distanceKm");
    expect(fields).not.toHaveProperty("polyline");
    expect(fields.name).toBe("Evening Run");
    expect(fields.sportType).toBe("Hike");
  });

  it("never includes Kadenz-owned columns — workoutId, strengthSessionId, id, aiInsight, streamsJson, createdAt", () => {
    const fields = stravaUpdateFields(baseActivity()) as unknown as Record<string, unknown>;
    for (const key of [
      "workoutId",
      "strengthSessionId",
      "id",
      "stravaId",
      "garminId",
      "aiInsight",
      "aiInsightGeneratedAt",
      "streamsJson",
      "createdAt",
    ]) {
      expect(fields).not.toHaveProperty(key);
    }
  });
});

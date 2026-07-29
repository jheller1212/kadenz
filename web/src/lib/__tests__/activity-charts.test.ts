import { describe, it, expect } from "vitest";
import { buildHeartRateChartData, isStrengthActivity } from "../activity-charts";

describe("isStrengthActivity", () => {
  it("treats a linked strength session (server-resolved sportType) as strength", () => {
    expect(isStrengthActivity("strength")).toBe(true);
  });

  it("treats raw Garmin/Strava strength sport types as strength", () => {
    expect(isStrengthActivity("WeightTraining")).toBe(true);
    expect(isStrengthActivity("Workout")).toBe(true);
    expect(isStrengthActivity("Crossfit")).toBe(true);
    expect(isStrengthActivity("HIIT")).toBe(true);
  });

  it("does not treat a run as strength", () => {
    expect(isStrengthActivity("Run")).toBe(false);
    expect(isStrengthActivity(null)).toBe(false);
  });
});

describe("buildHeartRateChartData", () => {
  it("returns null heartrate when the stream is missing or too short", () => {
    expect(buildHeartRateChartData(null, "Run", 10).heartrate).toBeNull();
    expect(
      buildHeartRateChartData(
        { distance: [0], time: [0], heartrate: [140] },
        "Run",
        10
      ).heartrate
    ).toBeNull();
  });

  it("plots a run against distance in km", () => {
    const result = buildHeartRateChartData(
      { distance: [0, 500, 1000], time: [0, 150, 300], heartrate: [130, 145, 150] },
      "Run",
      1
    );
    expect(result.axis).toBe("distance");
    expect(result.heartrate).toEqual([130, 145, 150]);
    expect(result.xData).toEqual([0, 0.5, 1]);
  });

  it("plots a strength activity (no distance) against elapsed time, not distance", () => {
    // distanceKm is 0 and the distance stream is empty/zero — this is the
    // exact shape that used to collapse the run chart onto a single point.
    const result = buildHeartRateChartData(
      { distance: [], time: [0, 60, 120, 180], heartrate: [110, 130, 125, 140] },
      "strength",
      0
    );
    expect(result.axis).toBe("time");
    expect(result.heartrate).toEqual([110, 130, 125, 140]);
    expect(result.xData).toEqual([0, 60, 120, 180]);
  });

  it("recognizes an unlinked strength activity via the raw device sport type", () => {
    const result = buildHeartRateChartData(
      { distance: [0, 0, 0], time: [0, 30, 60], heartrate: [100, 120, 118] },
      "WeightTraining",
      0
    );
    expect(result.axis).toBe("time");
    expect(result.xData).toEqual([0, 30, 60]);
  });

  it("falls back to sample index for a strength activity if time and heartrate lengths disagree", () => {
    const result = buildHeartRateChartData(
      { distance: [], time: [0, 60], heartrate: [110, 130, 125] },
      "strength",
      0
    );
    expect(result.axis).toBe("time");
    expect(result.xData).toEqual([0, 1, 2]);
  });

  it("falls back to an even distance spread for a run with no distance stream", () => {
    const result = buildHeartRateChartData(
      { distance: [], time: [0, 60, 120], heartrate: [130, 140, 135] },
      "Run",
      3
    );
    expect(result.axis).toBe("distance");
    expect(result.xData).toEqual([0, 1, 2]);
  });
});

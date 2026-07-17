import { describe, expect, it } from "vitest";
import {
  isDuplicateActivity,
  mapGarminSplits,
  normalizeLocalTimestamp,
  parseGmtTimestamp,
} from "../garmin-import";

const t = (iso: string) => new Date(iso);

describe("isDuplicateActivity", () => {
  const existing = [
    { startDate: t("2026-07-17T06:30:00Z"), durationSeconds: 3600 },
  ];

  it("matches same start and duration", () => {
    expect(
      isDuplicateActivity(
        { startDate: t("2026-07-17T06:30:00Z"), durationSeconds: 3600 },
        existing
      )
    ).toBe(true);
  });

  it("matches within ±10 minutes and ±15% duration", () => {
    expect(
      isDuplicateActivity(
        { startDate: t("2026-07-17T06:39:59Z"), durationSeconds: 3200 },
        existing
      )
    ).toBe(true);
    expect(
      isDuplicateActivity(
        { startDate: t("2026-07-17T06:20:01Z"), durationSeconds: 4100 },
        existing
      )
    ).toBe(true);
  });

  it("rejects starts more than 10 minutes apart", () => {
    expect(
      isDuplicateActivity(
        { startDate: t("2026-07-17T06:41:00Z"), durationSeconds: 3600 },
        existing
      )
    ).toBe(false);
    expect(
      isDuplicateActivity(
        { startDate: t("2026-07-17T06:19:00Z"), durationSeconds: 3600 },
        existing
      )
    ).toBe(false);
  });

  it("rejects durations differing by more than 15%", () => {
    expect(
      isDuplicateActivity(
        { startDate: t("2026-07-17T06:30:00Z"), durationSeconds: 3000 },
        existing
      )
    ).toBe(false);
    // 3060/3600 = 15% diff of the larger — right at the boundary (inclusive)
    expect(
      isDuplicateActivity(
        { startDate: t("2026-07-17T06:30:00Z"), durationSeconds: 3060 },
        existing
      )
    ).toBe(true);
  });

  it("falls back to the time window when a duration is missing", () => {
    expect(
      isDuplicateActivity(
        { startDate: t("2026-07-17T06:31:00Z"), durationSeconds: null },
        existing
      )
    ).toBe(true);
    expect(
      isDuplicateActivity(
        { startDate: t("2026-07-17T06:31:00Z"), durationSeconds: 3600 },
        [{ startDate: t("2026-07-17T06:30:00Z"), durationSeconds: null }]
      )
    ).toBe(true);
  });

  it("ignores rows without a start date and handles empty lists", () => {
    expect(
      isDuplicateActivity(
        { startDate: t("2026-07-17T06:30:00Z"), durationSeconds: 3600 },
        [{ startDate: null, durationSeconds: 3600 }]
      )
    ).toBe(false);
    expect(
      isDuplicateActivity(
        { startDate: t("2026-07-17T06:30:00Z"), durationSeconds: 3600 },
        []
      )
    ).toBe(false);
  });
});

describe("mapGarminSplits", () => {
  it("maps worker splits to the Strava-like shape the app reads", () => {
    const mapped = mapGarminSplits([
      { distanceKm: 1, durationSeconds: 300, avgHr: 150, avgPaceSecPerKm: 300 },
      { distanceKm: 0.42, durationSeconds: 126, avgHr: null, avgPaceSecPerKm: null },
    ]);

    expect(mapped[0]).toEqual({
      split: 1,
      distance: 1000,
      moving_time: 300,
      elapsed_time: 300,
      average_speed: 1000 / 300,
      average_heartrate: 150,
    });

    // No pace given: speed derived from distance/duration; no HR key at all.
    expect(mapped[1].split).toBe(2);
    expect(mapped[1].distance).toBeCloseTo(420);
    expect(mapped[1].average_speed).toBeCloseTo(420 / 126);
    expect("average_heartrate" in mapped[1]).toBe(false);
  });

  it("prefers the explicit pace over distance/duration", () => {
    const [s] = mapGarminSplits([
      { distanceKm: 1, durationSeconds: 290, avgPaceSecPerKm: 300 },
    ]);
    expect(s.average_speed).toBeCloseTo(1000 / 300);
  });

  it("handles zero-duration splits without dividing by zero", () => {
    const [s] = mapGarminSplits([{ distanceKm: 0.1, durationSeconds: 0 }]);
    expect(s.average_speed).toBe(0);
  });
});

describe("timestamp parsing", () => {
  it("normalizes Garmin space-separated timestamps", () => {
    expect(normalizeLocalTimestamp("2026-07-17 06:30:00")).toBe(
      "2026-07-17T06:30:00"
    );
    expect(normalizeLocalTimestamp("2026-07-17T06:30:00")).toBe(
      "2026-07-17T06:30:00"
    );
  });

  it("treats GMT timestamps without a zone as UTC (both formats)", () => {
    expect(parseGmtTimestamp("2026-07-17 06:30:00").toISOString()).toBe(
      "2026-07-17T06:30:00.000Z"
    );
    expect(parseGmtTimestamp("2026-07-17T06:30:00").toISOString()).toBe(
      "2026-07-17T06:30:00.000Z"
    );
  });

  it("respects an explicit zone offset", () => {
    expect(parseGmtTimestamp("2026-07-17T06:30:00Z").toISOString()).toBe(
      "2026-07-17T06:30:00.000Z"
    );
    expect(parseGmtTimestamp("2026-07-17T08:30:00+02:00").toISOString()).toBe(
      "2026-07-17T06:30:00.000Z"
    );
  });
});

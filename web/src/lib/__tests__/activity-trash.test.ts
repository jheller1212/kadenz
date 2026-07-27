import { describe, it, expect } from "vitest";
import { rowToPayload, payloadToRow, type ActivityRow } from "../activity-trash";

const baseRow: ActivityRow = {
  id: "11111111-1111-4111-8111-111111111111",
  workoutId: "22222222-2222-4222-8222-222222222222",
  strengthSessionId: null,
  sportType: "Run",
  stravaId: "9876543210",
  garminId: null,
  name: "Evening run",
  distanceKm: 10.42,
  durationSeconds: 3125,
  avgPaceSecKm: 300,
  avgHr: 152,
  maxHr: 178,
  elevationGain: 84.5,
  maxElevation: 210.2,
  startDate: new Date("2026-07-10T17:30:00.000Z"),
  splitsJson: [{ split: 1, distance: 1000, elapsed_time: 300, moving_time: 298, average_speed: 3.33 }],
  lapsJson: [{ lap_index: 1, distance: 10420, elapsed_time: 3125, moving_time: 3100, average_speed: 3.33 }],
  polyline: null,
  aiInsight: null,
  aiInsightGeneratedAt: null,
  bestEffortsJson: null,
  cadenceSpm: null,
  calories: null,
  deviceName: null,
  gearName: null,
  streamsJson: null,
  createdAt: new Date("2026-07-10T18:00:00.000Z"),
};

describe("rowToPayload", () => {
  it("serializes timestamps to ISO strings and keeps everything else as-is", () => {
    const payload = rowToPayload(baseRow);
    expect(payload.startDate).toBe("2026-07-10T17:30:00.000Z");
    expect(payload.createdAt).toBe("2026-07-10T18:00:00.000Z");
    expect(payload.distanceKm).toBe(10.42);
    expect(payload.splitsJson).toEqual(baseRow.splitsJson);
    expect(payload.stravaId).toBe("9876543210");
  });

  it("keeps null startDate as null", () => {
    const payload = rowToPayload({ ...baseRow, startDate: null });
    expect(payload.startDate).toBeNull();
  });

  it("produces JSON-safe output (survives JSON.stringify round-trip)", () => {
    const payload = rowToPayload(baseRow);
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });
});

describe("payloadToRow", () => {
  it("round-trips a full row through JSON storage", () => {
    const stored = JSON.parse(JSON.stringify(rowToPayload(baseRow)));
    const row = payloadToRow(stored);
    expect(row).toEqual(baseRow);
    expect(row.startDate).toBeInstanceOf(Date);
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it("round-trips a garmin-origin row with null startDate", () => {
    const original: ActivityRow = {
      ...baseRow,
      stravaId: null,
      garminId: "garmin-123",
      startDate: null,
    };
    const row = payloadToRow(JSON.parse(JSON.stringify(rowToPayload(original))));
    expect(row.startDate).toBeNull();
    expect(row.garminId).toBe("garmin-123");
    expect(row.stravaId).toBeNull();
  });

  it("backfills a missing createdAt (NOT NULL column)", () => {
    const payload = rowToPayload(baseRow);
    delete (payload as Record<string, unknown>).createdAt;
    const row = payloadToRow(payload);
    expect(row.createdAt).toBeInstanceOf(Date);
  });
});

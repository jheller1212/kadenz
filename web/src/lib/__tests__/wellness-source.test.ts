import { describe, expect, it } from "vitest";
import { selectWellnessSource, wellnessSourceLabel, type SourceNights } from "../wellness-source";
import type { WellnessNight } from "../physiology";
import { MIN_BASELINE_NIGHTS } from "../physiology";

function nights(count: number): WellnessNight[] {
  const out: WellnessNight[] = [];
  for (let i = 1; i <= count; i++) {
    out.push({ date: `2026-06-${String(i).padStart(2, "0")}`, sleepSeconds: 27000, restingHr: 50, hrvLastNightAvg: 60 });
  }
  return out;
}

describe("selectWellnessSource", () => {
  it("prefers garmin over apple_health when both clear the baseline floor", () => {
    const bySource: SourceNights[] = [
      { source: "apple_health", nights: nights(MIN_BASELINE_NIGHTS + 5) },
      { source: "garmin", nights: nights(MIN_BASELINE_NIGHTS + 1) },
    ];
    const r = selectWellnessSource(bySource, MIN_BASELINE_NIGHTS);
    expect(r.source).toBe("garmin");
    expect(r.nights.length).toBe(MIN_BASELINE_NIGHTS + 1);
  });

  it("picks the only source that clears the floor even if it's lower-ranked", () => {
    const bySource: SourceNights[] = [
      { source: "garmin", nights: nights(5) },
      { source: "apple_health", nights: nights(MIN_BASELINE_NIGHTS) },
    ];
    const r = selectWellnessSource(bySource, MIN_BASELINE_NIGHTS);
    expect(r.source).toBe("apple_health");
  });

  it("falls back to the source with the most nights when nobody clears the floor", () => {
    const bySource: SourceNights[] = [
      { source: "garmin", nights: nights(3) },
      { source: "apple_health", nights: nights(10) },
    ];
    const r = selectWellnessSource(bySource, MIN_BASELINE_NIGHTS);
    expect(r.source).toBe("apple_health");
  });

  it("breaks a fallback tie by rank", () => {
    const bySource: SourceNights[] = [
      { source: "manual", nights: nights(5) },
      { source: "garmin", nights: nights(5) },
    ];
    const r = selectWellnessSource(bySource, MIN_BASELINE_NIGHTS);
    expect(r.source).toBe("garmin");
  });

  it("sorts an unknown source string last instead of crashing", () => {
    const bySource: SourceNights[] = [
      { source: "some_new_wearable", nights: nights(MIN_BASELINE_NIGHTS + 5) },
      { source: "manual", nights: nights(1) },
    ];
    const r = selectWellnessSource(bySource, MIN_BASELINE_NIGHTS);
    // "some_new_wearable" clears the floor and manual doesn't, so it still
    // wins on count-based fallback rules despite being unranked.
    expect(r.source).toBe("some_new_wearable");
  });

  it("returns null when there is no usable history at all", () => {
    const r = selectWellnessSource([], MIN_BASELINE_NIGHTS);
    expect(r.source).toBeNull();
    expect(r.nights).toEqual([]);
  });

  it("ignores nights with no usable metrics when counting", () => {
    const emptyNights: WellnessNight[] = Array.from({ length: 10 }, (_, i) => ({
      date: `2026-05-${String(i + 1).padStart(2, "0")}`,
      sleepSeconds: null,
      restingHr: null,
      hrvLastNightAvg: null,
    }));
    const r = selectWellnessSource([{ source: "garmin", nights: emptyNights }], MIN_BASELINE_NIGHTS);
    expect(r.source).toBeNull();
  });
});

describe("wellnessSourceLabel", () => {
  it("maps known sources to human labels", () => {
    expect(wellnessSourceLabel("garmin")).toBe("Garmin");
    expect(wellnessSourceLabel("apple_health")).toBe("Apple Health");
    expect(wellnessSourceLabel("health_connect")).toBe("Health Connect");
    expect(wellnessSourceLabel("manual")).toBe("Entered by hand");
  });

  it("falls back to the raw string for an unknown source", () => {
    expect(wellnessSourceLabel("some_new_wearable")).toBe("some_new_wearable");
  });

  it("returns null when there is no source", () => {
    expect(wellnessSourceLabel(null)).toBeNull();
  });
});

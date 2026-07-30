import { describe, it, expect } from "vitest";
import {
  expectsPhysiology,
  isManualOnly,
  isSetupAnswered,
  parseConnections,
  shouldPromptSetup,
  UNANSWERED_DEVICE_SETUP,
  type DeviceSetup,
} from "@/lib/device-setup";

const ANSWERED = "2026-07-30T08:00:00.000Z";
const setup = (connections: DeviceSetup["connections"]): DeviceSetup => ({
  completedAt: ANSWERED,
  connections,
});

describe("parseConnections", () => {
  it("keeps known ids in canonical order regardless of stored order", () => {
    expect(parseConnections(["gcal", "garmin", "strava"])).toEqual([
      "strava",
      "garmin",
      "gcal",
    ]);
  });

  it("dedupes", () => {
    expect(parseConnections(["strava", "strava"])).toEqual(["strava"]);
  });

  it("drops unknown ids rather than rejecting the whole answer", () => {
    // A retired id must not make a stored answer unreadable, which would put
    // the athlete back into the one state that prompts them again.
    expect(parseConnections(["strava", "whoop", 7, null])).toEqual(["strava"]);
  });

  it("treats non-arrays as no connections", () => {
    expect(parseConnections(null)).toEqual([]);
    expect(parseConnections("strava")).toEqual([]);
    expect(parseConnections({ strava: true })).toEqual([]);
  });
});

describe("isSetupAnswered / shouldPromptSetup", () => {
  it("never asked means prompt", () => {
    expect(isSetupAnswered(UNANSWERED_DEVICE_SETUP)).toBe(false);
    expect(shouldPromptSetup(UNANSWERED_DEVICE_SETUP)).toBe(true);
  });

  it("answered with nothing is still answered, so it stops prompting", () => {
    // The whole point: "chose nothing" and "was never asked" look identical
    // in the connections array and must not be treated the same.
    expect(isSetupAnswered(setup([]))).toBe(true);
    expect(shouldPromptSetup(setup([]))).toBe(false);
  });
});

describe("isManualOnly", () => {
  it("is true when the athlete answered and picked no data source", () => {
    expect(isManualOnly(setup([]))).toBe(true);
  });

  it("is true for a calendar-only athlete, since nothing comes back in", () => {
    expect(isManualOnly(setup(["gcal"]))).toBe(true);
  });

  it("is false once a data source is picked", () => {
    expect(isManualOnly(setup(["strava"]))).toBe(false);
    expect(isManualOnly(setup(["garmin"]))).toBe(false);
  });

  it("is false before the athlete has answered", () => {
    expect(isManualOnly(UNANSWERED_DEVICE_SETUP)).toBe(false);
  });
});

describe("expectsPhysiology", () => {
  it("is false for an athlete who picked nothing", () => {
    // The bug this guards: warm-up needs 21 nights of HRV or resting HR. With
    // no device, none ever arrive, so "building your baseline" would never end.
    expect(expectsPhysiology(setup([]))).toBe(false);
  });

  it("is false for a Strava-only athlete", () => {
    // Strava has activities and no wellness, so it can never fill a baseline.
    expect(expectsPhysiology(setup(["strava"]))).toBe(false);
  });

  it("is false for a calendar-only athlete", () => {
    expect(expectsPhysiology(setup(["gcal"]))).toBe(false);
  });

  it("is true when a physiology source is connected", () => {
    expect(expectsPhysiology(setup(["garmin"]))).toBe(true);
    expect(expectsPhysiology(setup(["strava", "garmin"]))).toBe(true);
  });

  it("is true before the athlete has answered", () => {
    // An athlete who has not been asked yet may already have a watch syncing;
    // suppressing a real warm-up would be the opposite mistake.
    expect(expectsPhysiology(UNANSWERED_DEVICE_SETUP)).toBe(true);
  });
});

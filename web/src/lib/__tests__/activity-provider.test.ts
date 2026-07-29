import { describe, it, expect } from "vitest";
import { ACTIVITY_PROVIDER, buildProviderExternalId } from "../activity-provider";

describe("buildProviderExternalId", () => {
  it("normalizes a numeric Strava id to the strava provider pair", () => {
    expect(buildProviderExternalId(ACTIVITY_PROVIDER.strava, 555)).toEqual({
      provider: "strava",
      externalId: "555",
    });
  });

  it("normalizes a numeric Garmin id to the garmin provider pair", () => {
    expect(buildProviderExternalId(ACTIVITY_PROVIDER.garmin, 555)).toEqual({
      provider: "garmin",
      externalId: "555",
    });
  });

  // The entire point of the (provider, externalId) pair over the old single
  // stravaId/garminId columns: two providers reusing the same numeric id
  // must not collide. stravaId/garminId each had their own unique column so
  // this was never an issue before, but a shared external_id column needs
  // the provider half of the pair to keep them apart.
  it("keeps the same numeric external id from two providers distinct", () => {
    const strava = buildProviderExternalId(ACTIVITY_PROVIDER.strava, 555);
    const garmin = buildProviderExternalId(ACTIVITY_PROVIDER.garmin, 555);
    expect(strava.externalId).toBe(garmin.externalId);
    expect(strava.provider).not.toBe(garmin.provider);
    expect(strava).not.toEqual(garmin);
  });

  it("accepts a string id unchanged", () => {
    expect(buildProviderExternalId(ACTIVITY_PROVIDER.garmin, "abc-123")).toEqual({
      provider: "garmin",
      externalId: "abc-123",
    });
  });
});

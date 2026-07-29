// The allowlist is the only thing standing between a stranger who completed
// OAuth and a full session over the owner's training data, so its fail-closed
// behaviour is worth asserting rather than assuming.
//
// The owner-account helpers matter for a different reason: they decide which
// allowlisted account inherits every existing row (see Phase 2 of the
// multi-user plan). Getting that wrong means the owner logs in to an empty app.

import { afterEach, describe, expect, it } from "vitest";
import {
  isAllowedGoogleEmail,
  isAllowedStravaAthleteId,
  ownerGoogleEmail,
  ownerStravaAthleteId,
} from "../owner";

afterEach(() => {
  delete process.env.KADENZ_ALLOWED_STRAVA_ATHLETE_IDS;
  delete process.env.KADENZ_ALLOWED_GOOGLE_EMAILS;
});

describe("isAllowedStravaAthleteId", () => {
  it("rejects everyone when the allowlist is unset or empty", () => {
    expect(isAllowedStravaAthleteId(123)).toBe(false);
    process.env.KADENZ_ALLOWED_STRAVA_ATHLETE_IDS = "  ,  ";
    expect(isAllowedStravaAthleteId(123)).toBe(false);
  });

  it("accepts only listed athletes", () => {
    process.env.KADENZ_ALLOWED_STRAVA_ATHLETE_IDS = "123, 456";
    expect(isAllowedStravaAthleteId(123)).toBe(true);
    expect(isAllowedStravaAthleteId(456)).toBe(true);
    expect(isAllowedStravaAthleteId(789)).toBe(false);
    expect(isAllowedStravaAthleteId(null)).toBe(false);
  });
});

describe("isAllowedGoogleEmail", () => {
  it("rejects everyone when the allowlist is unset", () => {
    expect(isAllowedGoogleEmail("a@example.com")).toBe(false);
  });

  it("matches case-insensitively and rejects anyone unlisted", () => {
    process.env.KADENZ_ALLOWED_GOOGLE_EMAILS = "A@Example.com";
    expect(isAllowedGoogleEmail("a@example.com")).toBe(true);
    expect(isAllowedGoogleEmail("b@example.com")).toBe(false);
    expect(isAllowedGoogleEmail(null)).toBe(false);
  });
});

describe("owner account", () => {
  it("is the first entry of each allowlist", () => {
    process.env.KADENZ_ALLOWED_STRAVA_ATHLETE_IDS = "123, 456";
    process.env.KADENZ_ALLOWED_GOOGLE_EMAILS = "Owner@Example.com, tester@example.com";
    expect(ownerStravaAthleteId()).toBe("123");
    expect(ownerGoogleEmail()).toBe("owner@example.com");
  });

  it("is null when the allowlist is unset, so nobody inherits by accident", () => {
    expect(ownerStravaAthleteId()).toBeNull();
    expect(ownerGoogleEmail()).toBeNull();
  });
});

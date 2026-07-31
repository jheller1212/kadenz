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
  isGoogleSignupOpen,
  ownerGoogleEmail,
  ownerStravaAthleteId,
} from "../owner";

afterEach(() => {
  delete process.env.KADENZ_ALLOWED_STRAVA_ATHLETE_IDS;
  delete process.env.KADENZ_ALLOWED_GOOGLE_EMAILS;
  delete process.env.KADENZ_OWNER_STRAVA_ID;
  delete process.env.KADENZ_OWNER_GOOGLE_EMAIL;
  delete process.env.KADENZ_GOOGLE_SIGNUP_OPEN;
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

describe("Google sign-up switch", () => {
  it("is closed by default and closed for anything other than the exact string 'true'", () => {
    expect(isGoogleSignupOpen()).toBe(false);
    process.env.KADENZ_GOOGLE_SIGNUP_OPEN = "1";
    expect(isGoogleSignupOpen()).toBe(false);
    process.env.KADENZ_GOOGLE_SIGNUP_OPEN = "True";
    expect(isGoogleSignupOpen()).toBe(false);
  });

  it("opens once set to 'true'", () => {
    process.env.KADENZ_GOOGLE_SIGNUP_OPEN = "true";
    expect(isGoogleSignupOpen()).toBe(true);
  });

  it("keeps Google gated to the allowlist while closed, even with no allowlist set", () => {
    expect(isAllowedGoogleEmail("stranger@example.com")).toBe(false);
  });

  it("admits anyone with a verified email once open, allowlisted or not", () => {
    process.env.KADENZ_GOOGLE_SIGNUP_OPEN = "true";
    expect(isAllowedGoogleEmail("stranger@example.com")).toBe(true);
    expect(isAllowedGoogleEmail(null)).toBe(false);
  });

  it("does not affect Strava, which stays allowlist-only regardless", () => {
    process.env.KADENZ_GOOGLE_SIGNUP_OPEN = "true";
    expect(isAllowedStravaAthleteId(999)).toBe(false);
  });
});

describe("owner account", () => {
  it("is the sole allowlisted account when there is exactly one", () => {
    process.env.KADENZ_ALLOWED_STRAVA_ATHLETE_IDS = "123";
    process.env.KADENZ_ALLOWED_GOOGLE_EMAILS = "Owner@Example.com";
    expect(ownerStravaAthleteId()).toBe("123");
    expect(ownerGoogleEmail()).toBe("owner@example.com");
  });

  it("refuses to guess once a second account is allowlisted", () => {
    // This is the case that matters. Resolving as the owner means a session
    // over every row in the database, so an ambiguous allowlist must produce
    // a configuration error, never a plausible-looking answer. Adding a
    // tester without naming the owner explicitly has to fail loudly.
    process.env.KADENZ_ALLOWED_STRAVA_ATHLETE_IDS = "123,456";
    process.env.KADENZ_ALLOWED_GOOGLE_EMAILS = "owner@example.com,tester@example.com";
    expect(ownerStravaAthleteId()).toBeNull();
    expect(ownerGoogleEmail()).toBeNull();
  });

  it("takes the explicit owner vars over anything in the allowlists", () => {
    process.env.KADENZ_ALLOWED_STRAVA_ATHLETE_IDS = "123,456";
    process.env.KADENZ_ALLOWED_GOOGLE_EMAILS = "tester@example.com,owner@example.com";
    process.env.KADENZ_OWNER_STRAVA_ID = "456";
    process.env.KADENZ_OWNER_GOOGLE_EMAIL = "Owner@Example.com";
    expect(ownerStravaAthleteId()).toBe("456");
    expect(ownerGoogleEmail()).toBe("owner@example.com");
  });

  it("ignores an explicit var that is set to whitespace", () => {
    process.env.KADENZ_ALLOWED_STRAVA_ATHLETE_IDS = "123";
    process.env.KADENZ_OWNER_STRAVA_ID = "   ";
    expect(ownerStravaAthleteId()).toBe("123");
  });

  it("is null when nothing is configured, so nobody inherits by accident", () => {
    expect(ownerStravaAthleteId()).toBeNull();
    expect(ownerGoogleEmail()).toBeNull();
  });
});

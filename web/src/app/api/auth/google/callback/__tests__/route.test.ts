// Mirrors the Strava callback test (../../strava/callback/__tests__/route.test.ts):
// a non-allowlisted account gets a 403 and no session, the owner resolves as
// the owner, and -- specific to Google, since it can open beyond the
// allowlist -- a brand new sign-up must never resolve as the owner even when
// sign-up is wide open. That guard is isOwner's own email comparison in the
// route, independent of who is allowed to log in at all, and it is the one
// thing standing between "everyone may sign up" and "everyone may sign up as
// Jonas".

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

const getToken = vi.fn();
const verifyIdToken = vi.fn();
const createOAuth2Client = vi.fn(() => ({ getToken, verifyIdToken }));
const saveTokens = vi.fn().mockResolvedValue(undefined);
const resolveUserForLogin = vi.fn();

vi.mock("@/lib/sync/gcal-client", () => ({ createOAuth2Client, saveTokens }));
vi.mock("@/lib/users", () => ({ resolveUserForLogin }));

// Same reasoning as the Strava test: this only asserts saveTokens runs for the
// resolved user, not that a real Postgres transaction opens.
const withUser = vi.fn((_userId: string, fn: () => unknown) => fn());
vi.mock("@/db/with-user", () => ({ withUser }));

const { GET } = await import("../route");

const OWNER_EMAIL = "owner@example.com";
const OWNER_USER = "00000000-0000-0000-0000-000000000001";
const STRANGER_USER = "22222222-2222-4222-8222-222222222222";

function fakeRequest(code: string): NextRequest {
  return {
    nextUrl: new URL(`https://kadenz.test/api/auth/google/callback?code=${code}`),
  } as unknown as NextRequest;
}

function mockGoogleAccount(opts: {
  email: string;
  emailVerified?: boolean;
  sub?: string;
}) {
  getToken.mockResolvedValue({
    tokens: {
      refresh_token: "refresh-token",
      access_token: "access-token",
      id_token: "id-token",
      expiry_date: Date.now() + 3600_000,
    },
  });
  verifyIdToken.mockResolvedValue({
    getPayload: () => ({
      email: opts.email,
      email_verified: opts.emailVerified ?? true,
      sub: opts.sub ?? `sub-${opts.email}`,
      name: "Test Runner",
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  createOAuth2Client.mockReturnValue({ getToken, verifyIdToken });
  saveTokens.mockResolvedValue(undefined);
  resolveUserForLogin.mockResolvedValue(OWNER_USER);
  process.env.SESSION_SECRET = "test-secret-value";
  process.env.NEXT_PUBLIC_BASE_URL = "https://kadenz.test";
  process.env.KADENZ_ALLOWED_GOOGLE_EMAILS = OWNER_EMAIL;
  process.env.KADENZ_OWNER_GOOGLE_EMAIL = OWNER_EMAIL;
});

afterEach(() => {
  delete process.env.SESSION_SECRET;
  delete process.env.NEXT_PUBLIC_BASE_URL;
  delete process.env.KADENZ_ALLOWED_GOOGLE_EMAILS;
  delete process.env.KADENZ_OWNER_GOOGLE_EMAIL;
  delete process.env.KADENZ_GOOGLE_SIGNUP_OPEN;
});

describe("Google OAuth callback", () => {
  it("rejects a non-allowlisted account with 403 and mints no session while sign-up is closed", async () => {
    mockGoogleAccount({ email: "stranger@example.com" });

    const res = await GET(fakeRequest("abc"));

    expect(res.status).toBe(403);
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect(resolveUserForLogin).not.toHaveBeenCalled();
  });

  it("mints a session for the allowlisted owner, resolved as the owner", async () => {
    mockGoogleAccount({ email: OWNER_EMAIL });

    const res = await GET(fakeRequest("abc"));

    expect(resolveUserForLogin).toHaveBeenCalledWith(
      expect.objectContaining({ isOwner: true, email: OWNER_EMAIL })
    );
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain(`session=${OWNER_USER}:`);
  });

  it("lets a new Google account sign up once KADENZ_GOOGLE_SIGNUP_OPEN=true", async () => {
    process.env.KADENZ_GOOGLE_SIGNUP_OPEN = "true";
    resolveUserForLogin.mockResolvedValue(STRANGER_USER);
    mockGoogleAccount({ email: "new-runner@example.com" });

    const res = await GET(fakeRequest("abc"));

    expect(resolveUserForLogin).toHaveBeenCalledWith(
      expect.objectContaining({ isOwner: false, email: "new-runner@example.com" })
    );
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain(`session=${STRANGER_USER}:`);
  });

  it("still rejects an unlisted account when the switch is unset (default closed)", async () => {
    mockGoogleAccount({ email: "new-runner@example.com" });

    const res = await GET(fakeRequest("abc"));

    expect(res.status).toBe(403);
    expect(resolveUserForLogin).not.toHaveBeenCalled();
  });

  it("never resolves a new sign-up as the owner, even with sign-up wide open", async () => {
    process.env.KADENZ_GOOGLE_SIGNUP_OPEN = "true";
    resolveUserForLogin.mockResolvedValue(STRANGER_USER);
    // Sign-up open, allowlist still only names the owner: a brand new email
    // must resolve isOwner: false so it can never land a session over the
    // owner's data.
    mockGoogleAccount({ email: "someone-else@example.com" });

    await GET(fakeRequest("abc"));

    expect(resolveUserForLogin).toHaveBeenCalledWith(
      expect.objectContaining({ isOwner: false })
    );
  });

  it("rejects an unverified email even while sign-up is open", async () => {
    process.env.KADENZ_GOOGLE_SIGNUP_OPEN = "true";
    mockGoogleAccount({ email: "new-runner@example.com", emailVerified: false });

    const res = await GET(fakeRequest("abc"));

    expect(res.status).toBe(403);
    expect(resolveUserForLogin).not.toHaveBeenCalled();
  });
});

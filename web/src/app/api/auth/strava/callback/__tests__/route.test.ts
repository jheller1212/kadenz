// The callback is where a session is created, so it is where an unauthorized
// Strava account has to be turned away. Two things must stay true: a
// non-allowlisted athlete gets a 403 and no session, and the allowlisted owner
// gets a session carrying his user id rather than a bare "authenticated".

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

const exchangeCode = vi.fn();
const saveTokens = vi.fn().mockResolvedValue(undefined);
const resolveUserForLogin = vi.fn();

vi.mock("@/lib/sync/strava-client", () => ({ exchangeCode, saveTokens }));
vi.mock("@/lib/users", () => ({ resolveUserForLogin }));

// The route opens a real row level security context around saveTokens
// (see db/with-user.ts) — this test only cares that saveTokens is called for
// the resolved user, not that a real Postgres transaction runs, so withUser
// is stubbed to just invoke its callback.
const withUser = vi.fn((_userId: string, fn: () => unknown) => fn());
vi.mock("@/db/with-user", () => ({ withUser }));

const { GET } = await import("../route");

const OWNER_ATHLETE = 123;
const OWNER_USER = "00000000-0000-0000-0000-000000000001";

function fakeRequest(code: string): NextRequest {
  return {
    nextUrl: new URL(`https://kadenz.test/api/auth/strava/callback?code=${code}`),
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  saveTokens.mockResolvedValue(undefined);
  resolveUserForLogin.mockResolvedValue(OWNER_USER);
  process.env.SESSION_SECRET = "test-secret-value";
  process.env.KADENZ_ALLOWED_STRAVA_ATHLETE_IDS = String(OWNER_ATHLETE);
  process.env.NEXT_PUBLIC_BASE_URL = "https://kadenz.test";
});

afterEach(() => {
  delete process.env.SESSION_SECRET;
  delete process.env.KADENZ_ALLOWED_STRAVA_ATHLETE_IDS;
  delete process.env.NEXT_PUBLIC_BASE_URL;
});

describe("Strava OAuth callback", () => {
  it("rejects a non-allowlisted athlete with 403 and mints no session", async () => {
    exchangeCode.mockResolvedValue({ athlete_id: 999, access_token: "x" });

    const res = await GET(fakeRequest("abc"));

    expect(res.status).toBe(403);
    expect(res.headers.get("Set-Cookie")).toBeNull();
    // A stranger must not get as far as overwriting the stored owner tokens
    // or creating a user row for himself.
    expect(saveTokens).not.toHaveBeenCalled();
    expect(resolveUserForLogin).not.toHaveBeenCalled();
  });

  it("mints a session carrying the resolved user id for the allowlisted owner", async () => {
    exchangeCode.mockResolvedValue({ athlete_id: OWNER_ATHLETE, access_token: "x" });

    const res = await GET(fakeRequest("abc"));

    expect(resolveUserForLogin).toHaveBeenCalledWith({
      provider: "strava",
      providerAccountId: String(OWNER_ATHLETE),
      isOwner: true,
    });
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain(`session=${OWNER_USER}:`);
    expect(setCookie).not.toContain("authenticated");
    // saveTokens must run inside the resolved user's row level security
    // context, not on the ambient/unscoped connection.
    expect(withUser).toHaveBeenCalledWith(OWNER_USER, expect.any(Function));
    // Two arguments, and both matter: the user id says WHOSE credentials row
    // this is (phase 4 gave every user their own), and withUser above is what
    // lets that row be written at all under row level security.
    expect(saveTokens).toHaveBeenCalledWith(
      OWNER_USER,
      expect.objectContaining({ athlete_id: OWNER_ATHLETE })
    );
  });

  it("treats a second allowlisted athlete as a different user", async () => {
    process.env.KADENZ_ALLOWED_STRAVA_ATHLETE_IDS = `${OWNER_ATHLETE},456`;
    process.env.KADENZ_OWNER_STRAVA_ID = String(OWNER_ATHLETE);
    exchangeCode.mockResolvedValue({ athlete_id: 456, access_token: "x" });
    resolveUserForLogin.mockResolvedValue("33333333-3333-4333-8333-333333333333");

    await GET(fakeRequest("abc"));

    expect(resolveUserForLogin).toHaveBeenCalledWith(
      expect.objectContaining({ providerAccountId: "456", isOwner: false })
    );
    delete process.env.KADENZ_OWNER_STRAVA_ID;
  });

  it("refuses the login rather than guessing when the owner is ambiguous", async () => {
    // Two allowlisted athletes and no KADENZ_OWNER_STRAVA_ID. Picking one
    // would hand whoever it picked a session over all of the owner's data.
    process.env.KADENZ_ALLOWED_STRAVA_ATHLETE_IDS = `${OWNER_ATHLETE},456`;
    exchangeCode.mockResolvedValue({ athlete_id: OWNER_ATHLETE, access_token: "x" });

    const res = await GET(fakeRequest("abc"));

    expect(res.status).toBe(500);
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect(resolveUserForLogin).not.toHaveBeenCalled();
    expect(saveTokens).not.toHaveBeenCalled();
  });
});

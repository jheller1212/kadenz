// The consume route is where a session gets minted, so it is where a bad
// token has to be turned away with no side effect, and where the owner must
// never come out the other end.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

const consumeEmailLoginToken = vi.fn();
const resolveUserForEmailLogin = vi.fn();
const isEmailSignupOpen = vi.fn();

vi.mock("@/lib/email/tokens", () => ({ consumeEmailLoginToken }));
vi.mock("@/lib/owner", () => ({ isEmailSignupOpen }));

vi.mock("@/lib/users", () => ({
  resolveUserForEmailLogin,
  EmailSignupClosedError: class EmailSignupClosedError extends Error {},
}));

const { GET } = await import("../route");
const { EmailSignupClosedError } = await import("@/lib/users");

function fakeRequest(query: string): NextRequest {
  return {
    nextUrl: new URL(`https://kadenz.test/api/auth/email/consume${query}`),
  } as unknown as NextRequest;
}

const NEW_USER = "00000000-0000-0000-0000-000000000042";

beforeEach(() => {
  vi.clearAllMocks();
  isEmailSignupOpen.mockReturnValue(false);
  process.env.SESSION_SECRET = "test-secret-value";
  process.env.NEXT_PUBLIC_BASE_URL = "https://kadenz.test";
});

afterEach(() => {
  delete process.env.SESSION_SECRET;
  delete process.env.NEXT_PUBLIC_BASE_URL;
});

describe("GET /api/auth/email/consume", () => {
  it("redirects with an error and mints no session when email or token is missing", async () => {
    const res = await GET(fakeRequest("?email=a@example.com"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://kadenz.test/?email=error");
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect(consumeEmailLoginToken).not.toHaveBeenCalled();
  });

  it("redirects with an error for an expired, tampered, or reused token, without resolving a user", async () => {
    consumeEmailLoginToken.mockResolvedValue({ ok: false, reason: "expired" });

    const res = await GET(fakeRequest("?email=a@example.com&token=stale"));

    expect(res.headers.get("location")).toBe("https://kadenz.test/?email=error");
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect(resolveUserForEmailLogin).not.toHaveBeenCalled();
  });

  it("mints a session for a valid token and never carries owner status through", async () => {
    consumeEmailLoginToken.mockResolvedValue({ ok: true, email: "runner@example.com" });
    resolveUserForEmailLogin.mockResolvedValue(NEW_USER);

    const res = await GET(fakeRequest("?email=runner@example.com&token=good"));

    expect(resolveUserForEmailLogin).toHaveBeenCalledWith("runner@example.com", false);
    expect(res.headers.get("location")).toBe("https://kadenz.test/?email=connected");
    expect(res.headers.get("Set-Cookie") ?? "").toContain(`session=${NEW_USER}:`);
  });

  it("redirects distinctly when a new address hits a closed signup gate, minting no session", async () => {
    consumeEmailLoginToken.mockResolvedValue({ ok: true, email: "new@example.com" });
    resolveUserForEmailLogin.mockRejectedValue(new EmailSignupClosedError());

    const res = await GET(fakeRequest("?email=new@example.com&token=good"));

    expect(res.headers.get("location")).toBe("https://kadenz.test/?email=signup_closed");
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });
});

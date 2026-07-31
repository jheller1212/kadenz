// The leak this route must not have: a known address and an unknown one must
// be indistinguishable from the response alone. This route never queries
// `users` or `user_identities` at all (see the module comment in route.ts) --
// asserted here behaviorally, by calling it with two different addresses and
// checking the token/email machinery ran identically for both, not just that
// the status codes happened to match.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

const createEmailLoginToken = vi.fn();
const checkEmailRateLimit = vi.fn();
const send = vi.fn().mockResolvedValue(undefined);
const getEmailSender = vi.fn(() => ({ send }));

vi.mock("@/lib/email/tokens", () => ({
  createEmailLoginToken,
  normalizeEmail: (s: string) => s.trim().toLowerCase(),
}));
vi.mock("@/lib/email/rate-limit", () => ({ checkEmailRateLimit }));
vi.mock("@/lib/email/sender", () => ({ getEmailSender }));

const { POST } = await import("../route");

function fakeRequest(body: unknown, ip?: string): NextRequest {
  return {
    json: () => Promise.resolve(body),
    headers: new Headers(ip ? { "x-forwarded-for": ip } : {}),
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  createEmailLoginToken.mockResolvedValue("raw-token-value");
  checkEmailRateLimit.mockResolvedValue({ limited: false });
  process.env.NEXT_PUBLIC_BASE_URL = "https://kadenz.test";
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_BASE_URL;
});

describe("POST /api/auth/email/request", () => {
  it("returns the identical response for a never-seen address and a (mock) known one", async () => {
    const resUnknown = await POST(fakeRequest({ email: "never-signed-up@example.com" }, "203.0.113.1"));
    const resKnown = await POST(fakeRequest({ email: "already-has-account@example.com" }, "203.0.113.1"));

    expect(resUnknown.status).toBe(resKnown.status);
    expect(await resUnknown.clone().json()).toEqual(await resKnown.clone().json());
    // And it did the same amount of real work for both -- a token was minted
    // and a send attempted in both cases, not skipped for one of them.
    expect(createEmailLoginToken).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("mints a token and emails the link on success", async () => {
    const res = await POST(fakeRequest({ email: "Runner@Example.com" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(createEmailLoginToken).toHaveBeenCalledWith("runner@example.com", null);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "runner@example.com",
        text: expect.stringContaining("raw-token-value"),
      })
    );
  });

  it("rejects a malformed address before ever touching rate limiting or tokens", async () => {
    const res = await POST(fakeRequest({ email: "not-an-email" }));

    expect(res.status).toBe(400);
    expect(checkEmailRateLimit).not.toHaveBeenCalled();
    expect(createEmailLoginToken).not.toHaveBeenCalled();
  });

  it("trips the rate limit and sends nothing", async () => {
    checkEmailRateLimit.mockResolvedValue({ limited: true, reason: "address" });

    const res = await POST(fakeRequest({ email: "flooded@example.com" }));

    expect(res.status).toBe(429);
    expect(createEmailLoginToken).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("still answers ok:true if sending itself throws, so delivery failure is not observable on the wire", async () => {
    send.mockRejectedValueOnce(new Error("RESEND_API_KEY env var is not set."));

    const res = await POST(fakeRequest({ email: "misconfigured@example.com" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

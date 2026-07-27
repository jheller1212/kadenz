import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSessionCookie,
  isSessionFresh,
  makeSessionCookie,
  parseIssuedAtMs,
  validateSessionCookie,
} from "../session";

const ONE_DAY_MS = 1000 * 60 * 60 * 24;
const THIRTY_DAYS_MS = ONE_DAY_MS * 30;

function cookieHeaderFrom(setCookie: string): string {
  // makeSessionCookie() returns a full Set-Cookie header; a request's Cookie
  // header only carries the name=value pair.
  return setCookie.split(";")[0];
}

// Mirrors session.ts's internal hmacSign, kept local so the test can build a
// pre-fix (legacy, no-timestamp) cookie without exporting crypto internals
// from the module under test.
async function signLegacyPayload(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${payload}.${b64}`;
}

describe("parseIssuedAtMs", () => {
  it("extracts the timestamp from a current-format value", () => {
    expect(parseIssuedAtMs("authenticated:1700000000000")).toBe(1700000000000);
  });

  it("returns null for a legacy value with no timestamp", () => {
    expect(parseIssuedAtMs("authenticated")).toBeNull();
  });

  it("returns null when the suffix after the last colon isn't numeric", () => {
    expect(parseIssuedAtMs("authenticated:not-a-number")).toBeNull();
  });
});

describe("isSessionFresh", () => {
  const now = 1_700_000_000_000;

  it("accepts a session issued just now", () => {
    expect(isSessionFresh(now, now)).toBe(true);
  });

  it("accepts a session right up to the max age", () => {
    expect(isSessionFresh(now - THIRTY_DAYS_MS, now)).toBe(true);
  });

  it("rejects a session older than the max age", () => {
    expect(isSessionFresh(now - THIRTY_DAYS_MS - 1000, now)).toBe(false);
  });

  it("tolerates a small amount of clock skew into the future", () => {
    expect(isSessionFresh(now + 60_000, now)).toBe(true);
  });

  it("rejects a session issued implausibly far in the future", () => {
    expect(isSessionFresh(now + ONE_DAY_MS, now)).toBe(false);
  });
});

describe("cookie round-trip", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = "test-secret-value";
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.SESSION_SECRET;
  });

  it("validates a freshly minted cookie", async () => {
    vi.setSystemTime(1_700_000_000_000);
    const setCookie = await makeSessionCookie();
    const header = cookieHeaderFrom(setCookie);
    await expect(validateSessionCookie(header)).resolves.toBe(true);
  });

  it("rejects a cookie once it's past its max age", async () => {
    vi.setSystemTime(1_700_000_000_000);
    const setCookie = await makeSessionCookie();
    const header = cookieHeaderFrom(setCookie);

    vi.setSystemTime(1_700_000_000_000 + THIRTY_DAYS_MS + 1000);
    await expect(validateSessionCookie(header)).resolves.toBe(false);
  });

  it("rejects a tampered signature", async () => {
    vi.setSystemTime(1_700_000_000_000);
    const setCookie = await makeSessionCookie();
    const header = cookieHeaderFrom(setCookie).replace(/.$/, "x");
    await expect(validateSessionCookie(header)).resolves.toBe(false);
  });

  it("rejects a pre-expiry legacy cookie (no embedded timestamp), forcing a clean re-login", async () => {
    // Simulates a cookie minted by the old makeSessionCookie(): same HMAC
    // scheme, but the payload is just "authenticated" with no ":issuedAt"
    // suffix. Built by hand here (not via makeSessionCookie, which now always
    // embeds a timestamp) to prove old cookies are rejected, not trusted.
    const legacySigned = await signLegacyPayload("authenticated", "test-secret-value");
    const header = `session=${legacySigned}`;
    await expect(validateSessionCookie(header)).resolves.toBe(false);
  });

  it("rejects a missing cookie header", async () => {
    await expect(validateSessionCookie(null)).resolves.toBe(false);
    await expect(validateSessionCookie("")).resolves.toBe(false);
  });

  it("clearSessionCookie sets Max-Age=0", () => {
    expect(clearSessionCookie()).toContain("Max-Age=0");
  });
});

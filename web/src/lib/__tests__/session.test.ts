import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSessionCookie,
  isSessionFresh,
  makeSessionCookie,
  parseIssuedAtMs,
  parseUserId,
  getSessionUserId,
  validateSessionCookie,
} from "../session";
import { asUserId, type UserId } from "../user-id";

// Branded at the top rather than at each call: a UserId is what the session
// layer now takes, and asUserId is the one validating way to make one.
const USER_A = asUserId("11111111-1111-4111-8111-111111111111");
const USER_B = asUserId("22222222-2222-4222-8222-222222222222");

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
    expect(parseIssuedAtMs(`${USER_A}:1700000000000`)).toBe(1700000000000);
  });

  it("returns null for a legacy value with no timestamp", () => {
    expect(parseIssuedAtMs(USER_A)).toBeNull();
  });

  it("returns null when the suffix after the last colon isn't numeric", () => {
    expect(parseIssuedAtMs(`${USER_A}:not-a-number`)).toBeNull();
  });
});

describe("parseUserId", () => {
  it("extracts the user id from a current-format value", () => {
    expect(parseUserId(`${USER_A}:1700000000000`)).toBe(USER_A);
  });

  it("lowercases so an id is compared in one casing only", () => {
    expect(parseUserId(`${USER_A.toUpperCase()}:1700000000000`)).toBe(USER_A);
  });

  it("returns null for the pre-identity subject", () => {
    expect(parseUserId("authenticated:1700000000000")).toBeNull();
  });

  it("returns null when the subject is not a uuid", () => {
    expect(parseUserId("1:1700000000000")).toBeNull();
    expect(parseUserId("not-a-uuid:1700000000000")).toBeNull();
  });

  it("returns null when there is no subject at all", () => {
    expect(parseUserId("1700000000000")).toBeNull();
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
    const setCookie = await makeSessionCookie(USER_A);
    const header = cookieHeaderFrom(setCookie);
    await expect(validateSessionCookie(header)).resolves.toBe(true);
  });

  it("rejects a cookie once it's past its max age", async () => {
    vi.setSystemTime(1_700_000_000_000);
    const setCookie = await makeSessionCookie(USER_A);
    const header = cookieHeaderFrom(setCookie);

    vi.setSystemTime(1_700_000_000_000 + THIRTY_DAYS_MS + 1000);
    await expect(validateSessionCookie(header)).resolves.toBe(false);
  });

  it("rejects a tampered signature", async () => {
    vi.setSystemTime(1_700_000_000_000);
    const setCookie = await makeSessionCookie(USER_A);
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

  it("returns the user id the cookie was minted for", async () => {
    vi.setSystemTime(1_700_000_000_000);
    const headerA = cookieHeaderFrom(await makeSessionCookie(USER_A));
    const headerB = cookieHeaderFrom(await makeSessionCookie(USER_B));

    await expect(getSessionUserId(headerA)).resolves.toBe(USER_A);
    await expect(getSessionUserId(headerB)).resolves.toBe(USER_B);
  });

  it("rejects a correctly signed cookie in the pre-identity format rather than reading it as the owner", async () => {
    // A cookie minted before identity existed: same HMAC scheme, still inside
    // its max age, but its subject is the literal "authenticated". It must not
    // resolve to a user, or every old cookie would become an owner session.
    vi.setSystemTime(1_700_000_000_000);
    const signed = await signLegacyPayload(
      `authenticated:${Date.now()}`,
      "test-secret-value"
    );
    const header = `session=${signed}`;
    await expect(getSessionUserId(header)).resolves.toBeNull();
    await expect(validateSessionCookie(header)).resolves.toBe(false);
  });

  it("rejects a cookie whose user id was swapped without re-signing", async () => {
    vi.setSystemTime(1_700_000_000_000);
    const header = cookieHeaderFrom(await makeSessionCookie(USER_A));
    const forged = header.replace(USER_A, USER_B);
    await expect(getSessionUserId(forged)).resolves.toBeNull();
  });

  it("refuses to mint a session with no user id", async () => {
    // The cast is the point of the test: these are exactly the values the
    // branded type stops a caller passing by accident, so the only way to reach
    // the runtime guard is to defeat the type deliberately. The guard stays
    // because this mints the credential the whole app trusts.
    await expect(makeSessionCookie("" as UserId)).rejects.toThrow();
    await expect(makeSessionCookie("authenticated" as UserId)).rejects.toThrow();
  });

  it("asUserId refuses an id of the wrong kind", () => {
    // The two live bugs this brand exists for both passed a real, valid string
    // that was not a user id: a plan id, and the sync target "gcal".
    expect(() => asUserId("gcal")).toThrow();
    expect(() => asUserId("not-a-uuid")).toThrow();
    expect(asUserId("11111111-1111-4111-8111-111111111111")).toBe(
      "11111111-1111-4111-8111-111111111111"
    );
  });

  it("clearSessionCookie sets Max-Age=0", () => {
    expect(clearSessionCookie()).toContain("Max-Age=0");
  });
});

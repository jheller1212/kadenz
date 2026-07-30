import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SHELL_TOKEN_MAX_AGE_SECONDS,
  getSessionUserId,
  getShellTokenUserId,
  makeSessionCookie,
  makeShellToken,
  validateSessionCookie,
} from "../session";
import { resolveRequestUserId } from "../request-user";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

const ONE_DAY_MS = 1000 * 60 * 60 * 24;
const NOW = 1_700_000_000_000;

function cookieHeaderFrom(setCookie: string): string {
  return setCookie.split(";")[0];
}

function requestWith(headers: Record<string, string>): Request {
  return new Request("https://kadenz.test/api/push/subscribe", {
    method: "POST",
    headers,
  });
}

describe("shell bearer token", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = "test-secret-value";
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.SESSION_SECRET;
  });

  it("resolves to the user it was minted for", async () => {
    const tokenA = await makeShellToken(USER_A);
    const tokenB = await makeShellToken(USER_B);

    await expect(getShellTokenUserId(`Bearer ${tokenA}`)).resolves.toBe(USER_A);
    await expect(getShellTokenUserId(`Bearer ${tokenB}`)).resolves.toBe(USER_B);
  });

  it("accepts the scheme case-insensitively and tolerates extra whitespace", async () => {
    const token = await makeShellToken(USER_A);
    await expect(getShellTokenUserId(`bearer  ${token}`)).resolves.toBe(USER_A);
  });

  it("rejects an absent, empty or non-bearer header", async () => {
    const token = await makeShellToken(USER_A);
    await expect(getShellTokenUserId(null)).resolves.toBeNull();
    await expect(getShellTokenUserId("")).resolves.toBeNull();
    await expect(getShellTokenUserId(token)).resolves.toBeNull();
    await expect(getShellTokenUserId(`Basic ${token}`)).resolves.toBeNull();
  });

  it("rejects a tampered signature", async () => {
    const token = await makeShellToken(USER_A);
    await expect(
      getShellTokenUserId(`Bearer ${token.replace(/.$/, "x")}`)
    ).resolves.toBeNull();
  });

  it("rejects a token whose user id was swapped without re-signing", async () => {
    const token = await makeShellToken(USER_A);
    await expect(
      getShellTokenUserId(`Bearer ${token.replace(USER_A, USER_B)}`)
    ).resolves.toBeNull();
  });

  it("expires, so a copy taken off the device stops working", async () => {
    const token = await makeShellToken(USER_A);
    await expect(getShellTokenUserId(`Bearer ${token}`)).resolves.toBe(USER_A);

    vi.setSystemTime(NOW + SHELL_TOKEN_MAX_AGE_SECONDS * 1000 + 1000);
    await expect(getShellTokenUserId(`Bearer ${token}`)).resolves.toBeNull();
  });

  it("expires well before a session cookie does", async () => {
    // The point of the shorter life. A cookie is still good at this point.
    const token = await makeShellToken(USER_A);
    const cookie = cookieHeaderFrom(await makeSessionCookie(USER_A));

    vi.setSystemTime(NOW + ONE_DAY_MS * 2);
    await expect(getShellTokenUserId(`Bearer ${token}`)).resolves.toBeNull();
    await expect(validateSessionCookie(cookie)).resolves.toBe(true);
  });

  it("refuses to mint a token with no user id", async () => {
    await expect(makeShellToken("")).rejects.toThrow();
    await expect(makeShellToken("authenticated")).rejects.toThrow();
  });
});

// Both credentials are signed with the same secret, so nothing but the payload
// format stops one being presented as the other. These two tests are that
// format doing its job, in both directions.
describe("shell token and session cookie are not interchangeable", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = "test-secret-value";
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.SESSION_SECRET;
  });

  it("a shell token presented as a session cookie is not a session", async () => {
    const token = await makeShellToken(USER_A);
    await expect(getSessionUserId(`session=${token}`)).resolves.toBeNull();
  });

  it("a session cookie value presented as a bearer token is not a token", async () => {
    const setCookie = await makeSessionCookie(USER_A);
    const value = cookieHeaderFrom(setCookie).replace("session=", "");
    await expect(getShellTokenUserId(`Bearer ${value}`)).resolves.toBeNull();
  });
});

describe("resolveRequestUserId", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = "test-secret-value";
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.SESSION_SECRET;
  });

  it("resolves a cookie-authenticated request", async () => {
    const cookie = cookieHeaderFrom(await makeSessionCookie(USER_A));
    await expect(resolveRequestUserId(requestWith({ cookie }))).resolves.toBe(
      USER_A
    );
  });

  it("resolves a bearer-authenticated request, which is the native shell's only path", async () => {
    const token = await makeShellToken(USER_B);
    await expect(
      resolveRequestUserId(requestWith({ authorization: `Bearer ${token}` }))
    ).resolves.toBe(USER_B);
  });

  it("returns null when the request carries no credential at all", async () => {
    await expect(resolveRequestUserId(requestWith({}))).resolves.toBeNull();
  });

  it("returns null rather than a user when both credentials are invalid", async () => {
    await expect(
      resolveRequestUserId(
        requestWith({ cookie: "session=nonsense", authorization: "Bearer nonsense" })
      )
    ).resolves.toBeNull();
  });

  it("prefers the cookie when a request carries both", async () => {
    // The cookie cannot be replayed cross-site and the token can, so where a
    // request presents both, it is treated as the browser session it came from.
    const cookie = cookieHeaderFrom(await makeSessionCookie(USER_A));
    const token = await makeShellToken(USER_B);

    await expect(
      resolveRequestUserId(
        requestWith({ cookie, authorization: `Bearer ${token}` })
      )
    ).resolves.toBe(USER_A);
  });

  it("falls through to the token when the cookie is present but invalid", async () => {
    // An expired cookie alongside a good token must not lock the shell out.
    const token = await makeShellToken(USER_B);
    await expect(
      resolveRequestUserId(
        requestWith({
          cookie: "session=expired.garbage",
          authorization: `Bearer ${token}`,
        })
      )
    ).resolves.toBe(USER_B);
  });

  it("does not treat the cron secret as a user credential", async () => {
    // /api/cron/* authenticates with CRON_SECRET as a bearer. That is
    // installation-wide authority and must never resolve to a person, or a
    // maintenance job would start writing rows owned by whoever it resolved to.
    process.env.CRON_SECRET = "cron-secret-value";
    await expect(
      resolveRequestUserId(
        requestWith({ authorization: "Bearer cron-secret-value" })
      )
    ).resolves.toBeNull();
    delete process.env.CRON_SECRET;
  });
});

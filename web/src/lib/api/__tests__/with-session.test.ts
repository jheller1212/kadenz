// The status code withCronFanOut returns is a monitoring contract, not a
// detail. .github/workflows/sync-drain.yml fails the job on any non-2xx and the
// Cloudflare Worker in cron-worker/ re-throws on a non-2xx rather than logging,
// because the scheduler it replaced failed silently for weeks and nobody
// noticed. A uniform 200 with the failure buried in the response body would put
// us back in exactly that state, since nothing reads the body.
//
// So these tests exist to make that regression fail here rather than in
// production silence. If someone "simplifies" the aggregation away, this file is
// what says no.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// withUser and forEachUser just run the callback. The real transaction and RLS
// wiring is db/with-user.ts's own concern, not this wrapper's.
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
let fanOutUsers: string[] = [USER_A, USER_B];

vi.mock("@/db/with-user", () => ({
  withUser: (_userId: string, fn: () => unknown) => fn(),
  forEachUser: async (
    fn: (tx: unknown, userId: string) => Promise<unknown>
  ) => {
    const out: Array<{ userId: string; result: unknown }> = [];
    for (const userId of fanOutUsers) {
      out.push({ userId, result: await fn(null, userId) });
    }
    return out;
  },
}));

// Mock the identity RESOLVER, not lib/session. withSession asks
// resolveRequestUserId who is calling, and that function owns which credential
// was presented (cookie or the native shell's bearer token). Mocking one level
// down would tie this test to that choice and break whenever a new credential
// type is added, which is exactly what happened when the shell token landed.
let sessionUserId: string | null = null;
vi.mock("@/lib/request-user", () => ({
  resolveRequestUserId: async () => sessionUserId,
}));

const { withCronFanOut } = await import("../with-session");

const CRON_SECRET = "test-cron-secret";

function cronRequest(): NextRequest {
  return {
    url: "https://kadenz.test/api/cron/sync-drain",
    headers: new Headers({ authorization: `Bearer ${CRON_SECRET}` }),
  } as unknown as NextRequest;
}

function sessionRequest(): NextRequest {
  return {
    url: "https://kadenz.test/api/cron/sync-drain",
    headers: new Headers({ cookie: "session=whatever" }),
  } as unknown as NextRequest;
}

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET;
  fanOutUsers = [USER_A, USER_B];
  sessionUserId = null;
});

describe("withCronFanOut: status aggregation on the cron path", () => {
  it("returns 200 when every user succeeded", async () => {
    const route = withCronFanOut(async () => ({ ok: true, drained: 3 }), "test");
    const res = await route(cronRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.users).toBe(2);
    expect(body.failed).toBe(0);
  });

  it("returns 500 when any user failed, and still reports every user", async () => {
    const route = withCronFanOut(
      async (userId) =>
        userId === USER_B
          ? { ok: false, error: "garmin unreachable" }
          : { ok: true, drained: 3 },
      "test"
    );
    const res = await route(cronRequest());

    // The whole point: a partial failure is a failure for monitoring.
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.failed).toBe(1);
    // Every user ran. One user's outage must not skip the users behind them.
    expect(body.users).toBe(2);
    expect(body.results.map((r: { userId: string }) => r.userId)).toEqual([
      USER_A,
      USER_B,
    ]);
    expect(body.results[1].error).toBe("garmin unreachable");
  });

  it("runs every user's handler even when an earlier one failed", async () => {
    const seen: string[] = [];
    const route = withCronFanOut(async (userId) => {
      seen.push(userId);
      return userId === USER_A ? { ok: false, error: "boom" } : { ok: true };
    }, "test");
    await route(cronRequest());

    expect(seen).toEqual([USER_A, USER_B]);
  });

  it("does not treat a handler that reports no ok field as a failure", async () => {
    // A skipped iteration (Garmin is one shared device, so non-owners are
    // skipped) reports neither success nor failure. Reading a missing `ok` as
    // false would turn every no-op sweep into a paging 500.
    const route = withCronFanOut(
      async () => ({ skipped: true, reason: "owner-only work" }),
      "test"
    );
    const res = await route(cronRequest());

    expect(res.status).toBe(200);
    expect((await res.json()).failed).toBe(0);
  });

  it("returns 200 with no users when there are none, rather than erroring", async () => {
    fanOutUsers = [];
    const route = withCronFanOut(async () => ({ ok: true }), "test");
    const res = await route(cronRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toBe(0);
    expect(body.failed).toBe(0);
  });
});

describe("withCronFanOut: the owner-session path", () => {
  it("runs once as the caller and returns 200 on success", async () => {
    sessionUserId = USER_A;
    const seen: string[] = [];
    const route = withCronFanOut(async (userId) => {
      seen.push(userId);
      return { ok: true };
    }, "test");
    const res = await route(sessionRequest());

    expect(res.status).toBe(200);
    expect(seen).toEqual([USER_A]);
    expect((await res.json()).users).toBe(1);
  });

  it("returns 500 on failure, the same rule as the cron path", async () => {
    sessionUserId = USER_A;
    const route = withCronFanOut(async () => ({ ok: false, error: "boom" }), "test");
    const res = await route(sessionRequest());

    expect(res.status).toBe(500);
    expect((await res.json()).failed).toBe(1);
  });

  it("rejects a caller with no session and no bearer token", async () => {
    sessionUserId = null;
    const route = withCronFanOut(async () => ({ ok: true }), "test");
    const res = await route(sessionRequest());

    expect(res.status).toBe(401);
  });

  it("does not accept a bearer token when CRON_SECRET is unset", async () => {
    // Fail closed: an empty secret must never turn "Bearer " into access.
    delete process.env.CRON_SECRET;
    sessionUserId = null;
    const route = withCronFanOut(async () => ({ ok: true }), "test");
    const res = await route(cronRequest());

    expect(res.status).toBe(401);
  });
});

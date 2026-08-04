// sync-drain fans drainOutboxNow out over every user (listAllUserIds), one at
// a time. Before the outbox reshape, drainOutboxNow's own drains ran
// unscoped and swallowed every failure via Promise.allSettled — a drain
// failure never propagated, so this route always answered 200 regardless of
// whether anything actually synced. This test proves: one user's drain
// failure does not stop the user queued behind them, and the route still
// answers a non-2xx overall — the signal .github/workflows/sync-drain.yml
// and the Cloudflare Worker in cron-worker/ both key off.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const USER_A = "00000000-0000-0000-0000-000000000001";
const USER_B = "22222222-2222-4222-8222-222222222222";

let userIds = [USER_A, USER_B];
vi.mock("@/lib/users", () => ({
  listAllUserIds: vi.fn(async () => userIds),
}));

vi.mock("@/lib/session", () => ({
  validateSessionCookie: vi.fn().mockResolvedValue(false),
}));

const drainOutboxNow = vi.fn(async (userId: string) => {
  void userId;
  return { ok: true };
});
vi.mock("@/lib/sync/outbox-drain", () => ({
  drainOutboxNow: (userId: string) => drainOutboxNow(userId),
}));

const autoCloseAbandonedSessions = vi.fn(async () => ({ closed: 0 }));
vi.mock("@/lib/strength/schedule", () => ({
  autoCloseAbandonedSessions: () => autoCloseAbandonedSessions(),
}));

// The real withUser opens a database transaction and sets RLS context — not
// available in this unit test, and not the point of it. This route's only
// obligation to withUser is to call it once per user, scoping the drain and
// the auto-close to that user's context; that RLS wiring is db/with-user.ts's
// own concern (see its test suite). Recorded so tests can assert the
// auto-close call happens INSIDE a withUser scope, not after the loop with no
// scope at all — that gap is the bug this route used to have.
const withUserCalls: string[] = [];
vi.mock("@/db/with-user", () => ({
  withUser: (userId: string, fn: () => unknown) => {
    withUserCalls.push(userId);
    return fn();
  },
}));

let budgetExceededAfterUsers: number | null = null;
vi.mock("@/lib/cron/budget", () => ({
  createCronBudget: () => {
    let calls = 0;
    return {
      exceeded: () => {
        if (budgetExceededAfterUsers === null) return false;
        calls++;
        return calls > budgetExceededAfterUsers;
      },
      elapsedMs: () => 0,
    };
  },
}));

const { GET } = await import("../route");

function fakeRequest(headers: Record<string, string>): NextRequest {
  return {
    url: "https://kadenz.test/api/cron/sync-drain",
    headers: new Headers(headers),
  } as unknown as NextRequest;
}

const CRON_SECRET = "test-cron-secret";

beforeEach(() => {
  vi.clearAllMocks();
  userIds = [USER_A, USER_B];
  process.env.CRON_SECRET = CRON_SECRET;
  withUserCalls.length = 0;
  budgetExceededAfterUsers = null;
});

describe("GET /api/cron/sync-drain", () => {
  it("drains every user and reports 200 when all succeed", async () => {
    const res = await GET(fakeRequest({ authorization: `Bearer ${CRON_SECRET}` }));
    const body = await res.json();

    expect(drainOutboxNow).toHaveBeenCalledWith(USER_A);
    expect(drainOutboxNow).toHaveBeenCalledWith(USER_B);
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.drain).toEqual({ users: 2, drained: 2 });
  });

  it("still drains the second user when the first user's drain rejects, and reports a non-2xx", async () => {
    drainOutboxNow.mockImplementationOnce(async () => {
      throw new Error("google calendar API unreachable");
    });

    const res = await GET(fakeRequest({ authorization: `Bearer ${CRON_SECRET}` }));
    const body = await res.json();

    // Both users were attempted — user B's drain was not skipped because
    // user A's threw.
    expect(drainOutboxNow).toHaveBeenCalledWith(USER_A);
    expect(drainOutboxNow).toHaveBeenCalledWith(USER_B);
    expect(body.drain).toEqual({ users: 2, drained: 1 });

    expect(res.status).toBe(500);
    expect(body.ok).toBe(false);
  });

  it("reports a non-2xx when a drain resolves but reports ok:false, not just when it throws", async () => {
    drainOutboxNow.mockImplementationOnce(async () => ({ ok: false }));

    const res = await GET(fakeRequest({ authorization: `Bearer ${CRON_SECRET}` }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.ok).toBe(false);
  });

  it("rejects a request with neither the cron secret nor a signed-in session", async () => {
    const res = await GET(fakeRequest({}));

    expect(res.status).toBe(401);
    expect(drainOutboxNow).not.toHaveBeenCalled();
  });

  // Regression test for the bug this fixes: autoCloseAbandonedSessions used
  // to run once, globally, AFTER this loop with no RLS context at all, so
  // ownedBy(strengthSessions) -> currentUserId() threw on every single run
  // ("currentUserId() called outside a request context") and the failure was
  // swallowed by its own try/catch. It never actually closed a session in
  // production.
  it("runs the strength auto-close once per user, inside that user's withUser scope, and sums closed counts", async () => {
    autoCloseAbandonedSessions
      .mockResolvedValueOnce({ closed: 2 })
      .mockResolvedValueOnce({ closed: 3 });

    const res = await GET(fakeRequest({ authorization: `Bearer ${CRON_SECRET}` }));
    const body = await res.json();

    expect(autoCloseAbandonedSessions).toHaveBeenCalledTimes(2);
    // Every call happened inside a withUser(userId, ...) scope, one per user
    // — not a bare call outside any scope.
    expect(withUserCalls).toEqual([USER_A, USER_B]);
    expect(body.strengthAutoClosed).toEqual({ closed: 5 });
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("reports a non-2xx when the auto-close fails for a user, without skipping their drain or the next user", async () => {
    autoCloseAbandonedSessions.mockImplementationOnce(async () => {
      throw new Error("strength_sessions query failed");
    });

    const res = await GET(fakeRequest({ authorization: `Bearer ${CRON_SECRET}` }));
    const body = await res.json();

    // User A's drain still ran (auto-close failing doesn't abort the rest of
    // that user's own work), and user B was still attempted.
    expect(drainOutboxNow).toHaveBeenCalledWith(USER_A);
    expect(drainOutboxNow).toHaveBeenCalledWith(USER_B);
    expect(autoCloseAbandonedSessions).toHaveBeenCalledTimes(2);
    expect(body.drain).toEqual({ users: 2, drained: 2 });
    expect(body.strengthAutoCloseError).toBeTruthy();
    expect(res.status).toBe(500);
    expect(body.ok).toBe(false);
  });

  // The bounding behaviour: this loop must not be free to run until Vercel
  // kills it. Once the budget is spent, no new user's work starts, and the
  // response says so — the remaining users are picked up on the next
  // 15-minute tick rather than this invocation running indefinitely.
  it("stops starting new users once the cron budget is spent, and reports truncated: true", async () => {
    userIds = [USER_A, USER_B, "33333333-3333-4333-8333-333333333333"];
    budgetExceededAfterUsers = 1;

    const res = await GET(fakeRequest({ authorization: `Bearer ${CRON_SECRET}` }));
    const body = await res.json();

    expect(drainOutboxNow).toHaveBeenCalledTimes(1);
    expect(drainOutboxNow).toHaveBeenCalledWith(USER_A);
    expect(body.truncated).toBe(true);
    expect(body.drain).toEqual({ users: 3, drained: 1 });
    // A truncated pass is not itself a failure — the skipped users are not
    // errors, they are deferred to the next tick.
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });
});

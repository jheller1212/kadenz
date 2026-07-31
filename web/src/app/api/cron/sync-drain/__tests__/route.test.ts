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

vi.mock("@/lib/strength/schedule", () => ({
  autoCloseAbandonedSessions: vi.fn().mockResolvedValue({ closed: 0 }),
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
});

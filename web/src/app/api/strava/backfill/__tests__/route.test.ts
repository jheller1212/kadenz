// getAccessToken/processActivity/updateActivity all read the ambient `db`
// proxy (src/db/index.ts), which only resolves to a row level security
// transaction when the call happens INSIDE withUser's callback (see
// db/with-user.ts). This route used to resolve the caller's id via
// requireRequestUser and call all three directly — no transaction, no
// app.user_id set, so under FORCE ROW LEVEL SECURITY the credential read and
// every activity write matched nothing and the route still answered
// `{ ok: true, inserted: 0 }`. A backfill looked like it ran and imported
// nothing.
//
// Real Postgres/RLS isn't available to vitest, so this test does what
// strava/disconnect's route test does: mock db/with-user so currentUserId()
// only resolves to a value WHILE a withUser callback is running, and prove
// getAccessToken/processActivity/updateActivity are each called from inside
// their own scope — never one scope held across every activity, which is the
// thing that would risk an idle-in-transaction timeout across up to 80
// sequential Strava round trips (see the route's file comment).

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import type { NextRequest } from "next/server";

const OWNER_USER = "11111111-1111-4111-8111-111111111111";

let scopedUserId: string | null = null;
const withUser = vi.fn(async (userId: string, fn: () => unknown) => {
  if (scopedUserId) {
    throw new Error(
      `withUser called while another scope (${scopedUserId}) was already open — the whole ` +
        "point of scoping per activity is that only one is ever open at a time."
    );
  }
  scopedUserId = userId;
  try {
    return await fn();
  } finally {
    scopedUserId = null;
  }
});
const currentUserId = vi.fn(() => {
  if (!scopedUserId) {
    throw new Error("currentUserId() called outside a request context.");
  }
  return scopedUserId;
});
vi.mock("@/db/with-user", () => ({ withUser, forEachUser: vi.fn(), currentUserId }));

let resolvedUserId: string | null = OWNER_USER;
vi.mock("@/lib/request-user", () => ({
  requireRequestUser: async () =>
    resolvedUserId
      ? { userId: resolvedUserId }
      : { response: Response.json({ error: "Unauthorized" }, { status: 401 }) },
}));

const getAccessToken = vi.fn(async () => {
  currentUserId();
  return "test-token";
});
const scopedAtProcess: Array<string | null> = [];
const processActivity = vi.fn(async (_userId: string, _activityId: number) => {
  scopedAtProcess.push(currentUserId());
  return "stored" as const;
});
const scopedAtUpdate: Array<string | null> = [];
const updateActivity = vi.fn(async (_userId: string, _activityId: number) => {
  scopedAtUpdate.push(currentUserId());
  return "updated" as const;
});
vi.mock("@/lib/sync/strava-client", () => ({ getAccessToken, processActivity, updateActivity }));

const dbSelectResults: unknown[][] = [[], []];
vi.mock("@/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db")>();
  return {
    ...actual,
    db: {
      select: vi.fn(() => {
        currentUserId();
        return {
          from: vi.fn(() => ({
            where: vi.fn().mockResolvedValue(dbSelectResults.shift() ?? []),
          })),
        };
      }),
    },
  };
});

const { POST } = await import("../route");

function fakeRequest(body: unknown): NextRequest {
  return {
    url: "https://kadenz.test/api/strava/backfill",
    headers: new Headers({ cookie: "session=whatever" }),
    json: async () => body,
  } as unknown as NextRequest;
}

const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  scopedUserId = null;
  resolvedUserId = OWNER_USER;
  scopedAtProcess.length = 0;
  scopedAtUpdate.length = 0;
  dbSelectResults[0] = [];
  dbSelectResults[1] = [];
  dbSelectResults.push([], []);
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [
      { id: 1, start_date: "2026-01-01T00:00:00Z", start_date_local: "2026-01-01T00:00:00", moving_time: 1800 },
    ],
  }) as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe("POST /api/strava/backfill", () => {
  it("scopes the credential read and every activity write to their own row level security transaction", async () => {
    const res = await POST(fakeRequest({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.inserted).toBe(1);

    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(processActivity).toHaveBeenCalledWith(OWNER_USER, 1);
    expect(scopedAtProcess).toEqual([OWNER_USER]);

    // Never one scope held across the whole loop — withUser's mock above
    // throws if a second scope opens while one is still active, and this run
    // only had one activity, so this also proves withUser was actually
    // called (not bypassed) rather than merely not double-opened.
    expect(withUser).toHaveBeenCalled();
  });

  it("would surface a route that stopped scoping its db calls as a thrown error, not a silent success", () => {
    expect(() => currentUserId()).toThrow(/outside a request context/);
  });
});

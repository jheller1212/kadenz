// deleteCredentials reads the ambient `db` proxy (src/db/index.ts), which only
// resolves to the request's row level security transaction when the call
// happens INSIDE withUser's callback (see db/with-user.ts). This route used to
// resolve the caller's id via requireRequestUser and call deleteCredentials
// directly — no transaction, no app.user_id set, so under FORCE ROW LEVEL
// SECURITY the DELETE matched nothing and the route still answered
// { ok: true }. Disconnecting Strava looked like it worked and left the
// stored tokens in place.
//
// Real Postgres/RLS isn't available to vitest, so this test does what
// auth/strava/callback's route test does: mock db/with-user so
// currentUserId() only resolves to a value WHILE withUser's callback is
// running, and prove deleteCredentials is called from inside that window. A
// regression back to calling it outside withSession/withUser throws here
// (currentUserId() with no scope) instead of quietly reporting success.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const OWNER_USER = "11111111-1111-4111-8111-111111111111";

let scopedUserId: string | null = null;
const withUser = vi.fn(async (userId: string, fn: () => unknown) => {
  scopedUserId = userId;
  try {
    return await fn();
  } finally {
    scopedUserId = null;
  }
});
const currentUserId = vi.fn(() => {
  if (!scopedUserId) {
    throw new Error(
      "currentUserId() called outside a request context. Wrap the route in withSession()."
    );
  }
  return scopedUserId;
});
vi.mock("@/db/with-user", () => ({
  withUser,
  forEachUser: vi.fn(),
  currentUserId,
}));

let resolvedUserId: string | null = OWNER_USER;
vi.mock("@/lib/request-user", () => ({
  resolveRequestUserId: async () => resolvedUserId,
}));

const deleteCredentials = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/sync/credentials", () => ({ deleteCredentials }));

const { POST } = await import("../route");

function fakeRequest(): NextRequest {
  return {
    url: "https://kadenz.test/api/strava/disconnect",
    headers: new Headers({ cookie: "session=whatever" }),
  } as unknown as NextRequest;
}

// withSession's handler type takes a (request, context) pair — the route
// itself never reads context, but the call site still has to supply one to
// match the type.
const noContext = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
  resolvedUserId = OWNER_USER;
});

describe("POST /api/strava/disconnect", () => {
  it("deletes the caller's Strava credentials from inside the request's row level security scope", async () => {
    const res = await POST(fakeRequest(), noContext);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // withUser must have opened the scope, and deleteCredentials must have run
    // while it was open — not before withUser was called, not after it
    // returned. currentUserId() throwing outside that window is what would
    // catch a regression to calling deleteCredentials on the ambient/pooled
    // connection again.
    expect(withUser).toHaveBeenCalledWith(OWNER_USER, expect.any(Function));
    expect(deleteCredentials).toHaveBeenCalledWith(OWNER_USER, "strava");
    expect(deleteCredentials).toHaveBeenCalledTimes(1);
  });

  it("never calls deleteCredentials when the caller has no session", async () => {
    resolvedUserId = null;

    const res = await POST(fakeRequest(), noContext);

    expect(res.status).toBe(401);
    expect(deleteCredentials).not.toHaveBeenCalled();
    expect(withUser).not.toHaveBeenCalled();
  });

  it("would surface a route that stopped scoping the delete as a thrown error, not a silent 200", async () => {
    // Directly exercising the failure mode this test file exists to prevent:
    // deleteCredentials called with currentUserId() OUTSIDE withUser's
    // callback must throw, never quietly resolve.
    expect(() => currentUserId()).toThrow(/outside a request context/);
  });
});

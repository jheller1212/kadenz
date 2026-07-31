// The route's own job is small -- confirmation, calling deleteAccount with
// the SESSION's user id (never a body/param value), turning the owner guard
// into a 409, and clearing the cookie on success. The actual erase is proven
// separately in src/lib/__tests__/account-deletion.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const CALLER = "11111111-1111-4111-8111-111111111111";

const deleteAccount = vi.fn();
class OwnerCannotSelfDeleteError extends Error {}
vi.mock("@/lib/account-deletion", () => ({
  deleteAccount,
  OwnerCannotSelfDeleteError,
}));

const resolveRequestUserId = vi.fn().mockResolvedValue(CALLER);
vi.mock("@/lib/request-user", () => ({
  resolveRequestUserId,
  unauthorized: () => Response.json({ error: "Unauthorized" }, { status: 401 }),
}));

// withSession normally opens a real row level security transaction
// (db/with-user.ts) around the handler; this test only cares that
// deleteAccount is called for the resolved caller, not that a real Postgres
// transaction runs, so withUser is stubbed to just invoke its callback --
// same pattern as the Strava/Google callback route tests.
const withUser = vi.fn((_userId: string, fn: () => unknown) => fn());
vi.mock("@/db/with-user", () => ({ withUser, currentUserId: () => CALLER }));

vi.mock("@/lib/session", () => ({
  clearSessionCookie: () => "session=; Max-Age=0",
}));

const { DELETE } = await import("../route");

function fakeRequest(body: unknown): NextRequest {
  return {
    url: "https://kadenz.test/api/user/account",
    json: async () => body,
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveRequestUserId.mockResolvedValue(CALLER);
  deleteAccount.mockResolvedValue(undefined);
});

describe("DELETE /api/user/account", () => {
  it("refuses without the exact confirmation phrase, and deletes nothing", async () => {
    const res = await DELETE(fakeRequest({ confirmation: "delete" }), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(422);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("refuses a missing body", async () => {
    const res = await DELETE(fakeRequest({}), { params: Promise.resolve({}) });

    expect(res.status).toBe(422);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("deletes the SESSION's own account, never an id from the body", async () => {
    const res = await DELETE(
      fakeRequest({ confirmation: "DELETE MY ACCOUNT", userId: "someone-elses-id" }),
      { params: Promise.resolve({}) }
    );

    expect(res.status).toBe(422); // .strict() rejects the extra field
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("calls deleteAccount with the caller's own session id and clears the cookie", async () => {
    const res = await DELETE(fakeRequest({ confirmation: "DELETE MY ACCOUNT" }), {
      params: Promise.resolve({}),
    });

    expect(deleteAccount).toHaveBeenCalledWith(CALLER);
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });

  it("turns the owner guard into a 409 rather than a 500", async () => {
    deleteAccount.mockRejectedValue(new OwnerCannotSelfDeleteError("no"));

    const res = await DELETE(fakeRequest({ confirmation: "DELETE MY ACCOUNT" }), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(409);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("500s on an unexpected failure rather than pretending it worked", async () => {
    deleteAccount.mockRejectedValue(new Error("db exploded"));

    const res = await DELETE(fakeRequest({ confirmation: "DELETE MY ACCOUNT" }), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(500);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });
});

// ── Regression coverage for the nested-withUser self-deadlock ────────────────
//
// Root cause (see db/with-user.ts): db/index.ts caps the pooled client at ONE
// connection per function instance. A caller already inside a withUser scope
// that calls withUser again for the SAME user — the shape of a plan
// mutation's after() callback re-entering withUser and then calling
// drainOutboxNow(), which calls processGarminOutbox()/processGCalOutbox(),
// both of which call withUser themselves unconditionally — used to fall
// through to db.transaction(...) again. That asked the single connection to
// open a second transaction while the first was still in progress: either a
// client-side self-deadlock (the outer callback cannot return, and so cannot
// free the connection, until the inner call it is awaiting resolves) or,
// once a request timed out and the instance was reused warm with the
// wedged transaction still open, the next request's BEGIN landing on a
// session that never committed — the exact `WARNING: there is already a
// transaction in progress` observed in production, and the connection
// sitting idle-in-transaction on ClientRead until something reclaimed it.
//
// These tests assert the fix directly against the transaction count: a
// same-user nested call must never ask the pooled client for a second
// transaction, and a different-user nested call must be refused rather than
// silently mixing RLS contexts on one connection.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { asUserId } from "@/lib/user-id";

const USER_A = asUserId("11111111-1111-4111-8111-111111111111");
const USER_B = asUserId("22222222-2222-4222-8222-222222222222");

let transactionCalls = 0;
let executeCalls = 0;

vi.mock("@/db/index", () => ({
  db: {
    transaction: async (fn: (tx: unknown) => unknown) => {
      transactionCalls++;
      const tx = {
        execute: async () => {
          executeCalls++;
          return [];
        },
      };
      return fn(tx);
    },
  },
}));

const { withUser } = await import("../with-user");

beforeEach(() => {
  transactionCalls = 0;
  executeCalls = 0;
});

describe("withUser: reentrancy on the single pooled connection", () => {
  it("opens exactly one transaction for a single call", async () => {
    await withUser(USER_A, async () => "ok");
    expect(transactionCalls).toBe(1);
  });

  it("a same-user nested call joins the outer transaction instead of opening a second one", async () => {
    // Mirrors the real shape: an after() callback's withUser(ownerId, ...)
    // calling something (drainOutboxNow -> processGarminOutbox) that calls
    // withUser(ownerId, ...) again for the same owner.
    const result = await withUser(USER_A, async () => {
      return withUser(USER_A, async () => "inner result");
    });

    expect(result).toBe("inner result");
    // The whole point: no second BEGIN was ever requested on the one
    // connection, so there is nothing for it to queue behind or deadlock on.
    expect(transactionCalls).toBe(1);
  });

  it("runs the inner callback on the SAME transaction handle as the outer one", async () => {
    let outerTx: unknown;
    let innerTx: unknown;

    await withUser(USER_A, async (tx) => {
      outerTx = tx;
      await withUser(USER_A, async (tx2) => {
        innerTx = tx2;
      });
    });

    expect(innerTx).toBe(outerTx);
  });

  it("refuses a nested call for a DIFFERENT user rather than mixing RLS contexts", async () => {
    await expect(
      withUser(USER_A, async () => {
        return withUser(USER_B, async () => "should not run");
      })
    ).rejects.toThrow(/nesting withUser for a different user/);

    // Only the outer (refused) attempt's transaction was ever opened.
    expect(transactionCalls).toBe(1);
  });

  it("still opens a fresh transaction for two SEQUENTIAL (non-nested) calls", async () => {
    await withUser(USER_A, async () => "first");
    await withUser(USER_A, async () => "second");

    // Sequential, not nested: the first call's transaction has already
    // committed (txStore is exited) by the time the second one runs, so this
    // is the ordinary one-transaction-per-request case, not reentrancy.
    expect(transactionCalls).toBe(2);
  });

  it("sets the RLS context (set_config) exactly once even when a same-user call nests", async () => {
    // withUser's only tx.execute() call is the set_config that scopes RLS.
    // One execute() means one set_config, regardless of how many times
    // withUser itself is (re)entered for the same user in this call chain.
    await withUser(USER_A, async () => {
      return withUser(USER_A, async () => "ok");
    });

    expect(executeCalls).toBe(1);
  });
});

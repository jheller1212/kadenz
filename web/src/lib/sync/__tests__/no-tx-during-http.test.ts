// ── The guarantee: no database transaction is open while we wait on Google ──
//
// This is the architectural cause of the 2026-07 incident, stated as a test.
// A revoked Google grant left hundreds of outbox rows retrying inside a
// withUser transaction; db/index.ts caps the client at ONE connection per
// function instance, so unrelated queries queued behind it until
// `select "id" from "users"` — the simplest query in the app — hit the 120s
// statement timeout while WAITING, not computing.
//
// #159 (wall-clock budget) and #162 (invalid_grant is terminal) removed that
// trigger. Neither removed the property that caused it: an outbound call that
// hangs still holds the connection for as long as it hangs. Google going slow
// is not something this app can fix from its side, so it must stop being able
// to be hurt by it.
//
// Asserting the PROPERTY rather than the arrangement matters, because the
// arrangement is easy to undo by accident. withUser is REENTRANT
// (db/with-user.ts): a nested call joins the transaction already open instead
// of starting its own. Re-introducing a withUser anywhere above the drain —
// or going back to forEachUser in the cron, which opens one per user — would
// silently put every Google call back inside a transaction, with no visible
// change at the call site. This test is what notices.
//
// The database is faked; the async-context machinery is NOT. The real
// txStore, and a db.transaction that enters it exactly as the real one does,
// are what make "was a transaction open here?" a meaningful question to ask.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { txStore } from "@/db/tx-store";

const OWNER_USER = "00000000-0000-0000-0000-000000000001";

/** The transaction context observed at the moment of each outbound call. */
let contextsDuringHttp: Array<string | null> = [];
/** How deep the fake transaction nesting got — proves reentrancy stayed sane. */
let openTransactions = 0;
let maxOpenTransactions = 0;

function recordContext() {
  const store = txStore.getStore();
  contextsDuringHttp.push(store ? store.userId : null);
}

// A chainable stub standing in for drizzle's builders. Every terminal await
// resolves to an empty result set, which is all this test needs: it asserts
// where the calls happen, never what they return.
function builder(): unknown {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const method of ["set", "where", "from", "values", "returning", "orderBy", "limit", "onConflictDoNothing"]) {
    chain[method] = self;
  }
  chain.then = (resolve: (v: unknown) => unknown) => resolve([]);
  return chain;
}

const fakeDb = {
  select: builder,
  update: builder,
  insert: builder,
  delete: builder,
  // claimJobs does Array.from(rows), so the result must be iterable itself
  // rather than a { rows } wrapper — postgres.js returns an array-like.
  execute: async (): Promise<unknown> => [],
  query: {
    workouts: { findFirst: async () => null },
    strengthSessions: { findFirst: async () => null },
  },
  // The part that must behave like the real thing: entering a transaction
  // enters the store, and leaving it leaves the store.
  transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
    openTransactions++;
    maxOpenTransactions = Math.max(maxOpenTransactions, openTransactions);
    try {
      return await cb(fakeDb);
    } finally {
      openTransactions--;
    }
  },
};

vi.mock("@/db", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/db/schema");
  return { ...actual, db: fakeDb };
});

vi.mock("../gcal-client", () => ({
  isConnected: vi.fn(async () => true),
  createEvent: vi.fn(async () => {
    recordContext();
    return "evt_created";
  }),
  patchEvent: vi.fn(async () => recordContext()),
  deleteEvent: vi.fn(async () => recordContext()),
  createStrengthEvent: vi.fn(async () => {
    recordContext();
    return "evt_strength";
  }),
  patchStrengthEvent: vi.fn(async () => recordContext()),
  markGCalDisconnected: vi.fn(async () => {}),
}));

describe("outbound sync calls hold no database transaction", () => {
  beforeEach(() => {
    contextsDuringHttp = [];
    openTransactions = 0;
    maxOpenTransactions = 0;
    vi.clearAllMocks();
  });

  it("the probe itself distinguishes inside a transaction from outside one", async () => {
    // Without this, a broken probe would make the real assertions below pass
    // for the wrong reason — by never observing anything at all.
    const { createEvent } = await import("../gcal-client");

    await createEvent(OWNER_USER, {} as never);
    expect(contextsDuringHttp).toEqual([null]);

    await txStore.run({ tx: {}, userId: OWNER_USER }, async () => {
      await createEvent(OWNER_USER, {} as never);
    });
    expect(contextsDuringHttp).toEqual([null, OWNER_USER]);
  });

  it("a workout create reaches Google with no transaction open", async () => {
    const jobs = [
      {
        id: "job-1",
        userId: OWNER_USER,
        entityType: "workout",
        entityId: "workout-1",
        action: "create",
        target: "gcal",
        status: "processing",
        attempts: 1,
        payload: null,
        lastError: null,
        createdAt: new Date(),
        processedAt: null,
        claimedAt: new Date(),
        idempotencyKey: "k1",
      },
    ];
    fakeDb.execute = async () => jobs;
    fakeDb.query.workouts.findFirst = async () =>
      ({ id: "workout-1", userId: OWNER_USER, blocks: [], date: new Date(), type: "easy", title: "Easy" }) as never;

    const { processGCalOutbox } = await import("../sync-manager");
    const { asUserId } = await import("@/lib/user-id");
    await processGCalOutbox(asUserId(OWNER_USER));

    expect(contextsDuringHttp.length, "no outbound call was made — the test proved nothing").toBeGreaterThan(0);
    expect(
      contextsDuringHttp,
      `a transaction was open during an outbound call: ${JSON.stringify(contextsDuringHttp)}`
    ).toEqual(contextsDuringHttp.map(() => null));
  });

  it("never nests transactions while draining", async () => {
    // The drain opens and commits several short transactions in sequence. If
    // any of them overlapped, the single pooled connection would have to serve
    // two at once — the self-deadlock withUser's reentrancy exists to prevent.
    expect(maxOpenTransactions).toBeLessThanOrEqual(1);
  });
});

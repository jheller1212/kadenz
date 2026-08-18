// drainOutboxNow used to call processGCalOutbox()/processGarminOutbox() with
// no user at all — those two drains claimed across every user's queued rows
// in one unscoped query, which is exactly what FORCE row level security
// refuses (see the outbox reshape that scoped claimJobs to one user's rows
// per call). This test proves drainOutboxNow now threads its own `userId`
// into both drains, and that one drain rejecting doesn't stop the other or
// go unreported — `{ ok: false }` is what callers with an HTTP response to
// give (cron/sync-drain) key their status code off.

import { describe, expect, it, vi, beforeEach } from "vitest";

const OWNER_USER = "00000000-0000-0000-0000-000000000001";

let openTransactions = 0;
let maxConcurrentTransactions = 0;
const processGarminOutbox = vi.fn(async (userId: string) => {
  // Stands in for the real drain, which holds a transaction for its whole
  // duration on the instance's ONE connection.
  openTransactions++;
  maxConcurrentTransactions = Math.max(maxConcurrentTransactions, openTransactions);
  await new Promise((r) => setTimeout(r, 0));
  openTransactions--;
  return { processed: 0, succeeded: 0, failed: 0, errors: [], __userId: userId };
});
vi.mock("../garmin-sync", () => ({
  processGarminOutbox: (userId: string) => processGarminOutbox(userId),
  queueGarminStrengthWindowSync: vi.fn().mockResolvedValue(0),
}));

const processGCalOutbox = vi.fn(async (userId: string) => {
  openTransactions++;
  maxConcurrentTransactions = Math.max(maxConcurrentTransactions, openTransactions);
  await new Promise((r) => setTimeout(r, 0));
  openTransactions--;
  return { processed: 0, succeeded: 0, failed: 0, errors: [], __userId: userId };
});
// Records the transaction scope active at the moment of the call, so a test
// can assert not just THAT resetStaleClaims ran but that it ran with an
// app.user_id set. Without a scope its bare UPDATE matches zero rows under
// FORCE row level security and reports success — a silent no-op.
const resetStaleClaims = vi.fn(async (target: string, userId: string) => {
  resetStaleClaimsScopes.push({ target, userId, scope: currentScope });
  return 0;
});
vi.mock("../sync-manager", () => ({
  processGCalOutbox: (userId: string) => processGCalOutbox(userId),
  resetStaleClaims: (target: string, userId: string) => resetStaleClaims(target, userId),
}));

const resetStaleClaimsScopes: Array<{ target: string; userId: string; scope: string | null }> = [];
let currentScope: string | null = null;
vi.mock("@/db/with-user", () => ({
  withUser: async (userId: string, fn: () => unknown) => {
    currentScope = userId;
    try {
      return await fn();
    } finally {
      currentScope = null;
    }
  },
}));

let connected = true;
const isConnectedScopes: Array<string | null> = [];
vi.mock("../gcal-client", () => ({
  isConnected: vi.fn(async () => {
    isConnectedScopes.push(currentScope);
    return connected;
  }),
}));

let garminEnabled = true;
const garminGateScopes: Array<string | null> = [];
vi.mock("../garmin-config", () => ({
  isGarminWorkoutSyncEnabled: vi.fn(async () => {
    garminGateScopes.push(currentScope);
    return garminEnabled;
  }),
}));

vi.mock("next/server", () => ({ after: vi.fn() }));

const { drainOutboxNow } = await import("../outbox-drain");

beforeEach(() => {
  vi.clearAllMocks();
  connected = true;
  garminEnabled = true;
  resetStaleClaimsScopes.length = 0;
  isConnectedScopes.length = 0;
  openTransactions = 0;
  maxConcurrentTransactions = 0;
  garminGateScopes.length = 0;
  currentScope = null;
});

describe("drainOutboxNow", () => {
  it("scopes both drains to the caller's own userId", async () => {
    await drainOutboxNow(OWNER_USER);

    expect(processGarminOutbox).toHaveBeenCalledWith(OWNER_USER);
    expect(processGCalOutbox).toHaveBeenCalledWith(OWNER_USER);
  });

  it("skips the gcal drain when the caller has no calendar connected, but still runs garmin", async () => {
    connected = false;

    await drainOutboxNow(OWNER_USER);

    expect(processGCalOutbox).not.toHaveBeenCalled();
    expect(processGarminOutbox).toHaveBeenCalledWith(OWNER_USER);
  });

  it("reports ok:false when one drain rejects, without the rejection stopping the other", async () => {
    processGarminOutbox.mockRejectedValueOnce(new Error("garmin worker unreachable"));

    const result = await drainOutboxNow(OWNER_USER);

    expect(processGCalOutbox).toHaveBeenCalledWith(OWNER_USER);
    expect(result).toEqual({ ok: false });
  });

  it("reports ok:true when both drains succeed", async () => {
    const result = await drainOutboxNow(OWNER_USER);
    expect(result).toEqual({ ok: true });
  });

  // A row claimed at the instant a grant died stays in `processing` forever:
  // the only thing that releases one is resetStaleClaims, and that lives
  // INSIDE the calendar drain, which is skipped precisely because the
  // calendar is disconnected. One sat stuck that way for four days —
  // invisible to the pending count, never retried, never failed.
  it("releases stranded calendar claims when the calendar is disconnected", async () => {
    connected = false;

    await drainOutboxNow(OWNER_USER);

    expect(processGCalOutbox).not.toHaveBeenCalled();
    expect(resetStaleClaimsScopes).toHaveLength(1);
    expect(resetStaleClaimsScopes[0]).toMatchObject({ target: "gcal", userId: OWNER_USER });
  });

  // The bug this shipped with for one deploy. sync-drain calls drainOutboxNow
  // with no transaction open (#173), so an unwrapped UPDATE here silently
  // matched nothing and the stranded row stayed stranded. Asserting the call
  // happened is not enough — it has to happen inside a scope.
  it("runs that release inside a withUser scope, not on the bare connection", async () => {
    connected = false;

    await drainOutboxNow(OWNER_USER);

    expect(resetStaleClaimsScopes[0].scope).toBe(OWNER_USER);
  });

  it("does not touch stale claims while the calendar is still connected", async () => {
    // Connected means the drain itself resets them; doing it here too would
    // race the claim the drain is about to make.
    connected = true;

    await drainOutboxNow(OWNER_USER);

    expect(processGCalOutbox).toHaveBeenCalled();
    expect(resetStaleClaimsScopes).toHaveLength(0);
  });

  // ── Every tenanted gate runs inside a scope ────────────────────────────────
  //
  // These read integration_credentials and user_integration_state, both under
  // FORCE row level security. drainOutboxNow is called with no transaction
  // open, so an unwrapped read here returns nothing rather than failing — the
  // gate answers a confident, silent "no" and the work behind it is skipped.
  //
  // That shipped: for one deploy the calendar drain was skipped on every run
  // while the endpoint reported {"ok":true,"drained":1}, and a reconnected
  // calendar still delivered nothing. Asserting the drain "was called" cannot
  // catch it — the drain is exactly what does not get called. The scope at the
  // moment of the GATE is the thing to assert.
  it("checks the calendar connection inside a scope, not on the bare connection", async () => {
    await drainOutboxNow(OWNER_USER);

    expect(isConnectedScopes).toEqual([OWNER_USER]);
  });

  it("checks the watch-sync toggle inside a scope too", async () => {
    await drainOutboxNow(OWNER_USER);

    expect(garminGateScopes).toEqual([OWNER_USER]);
  });

  // The drains must never overlap. db/index.ts caps the client at ONE physical
  // connection per instance and each drain opens its own transaction on it, so
  // starting both together is not parallelism — it is two transactions
  // contending for one connection. The second BEGIN queues behind the first,
  // which cannot finish, and the invocation runs until the platform kills it
  // at 300s.
  //
  // The damage showed up somewhere else entirely: the killed request left its
  // connection idle-in-transaction, and the NEXT request on that warm instance
  // died with "there is already a transaction in progress" — which is how a
  // cron broke the Google Calendar reconnect page with a 500.
  it("runs the two drains one after the other, never overlapping", async () => {
    await drainOutboxNow(OWNER_USER);

    expect(processGarminOutbox).toHaveBeenCalled();
    expect(processGCalOutbox).toHaveBeenCalled();
    expect(maxConcurrentTransactions).toBe(1);
  });
});

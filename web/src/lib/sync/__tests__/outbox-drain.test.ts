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

const processGarminOutbox = vi.fn(async (userId: string) => ({
  processed: 0,
  succeeded: 0,
  failed: 0,
  errors: [],
  __userId: userId,
}));
vi.mock("../garmin-sync", () => ({
  processGarminOutbox: (userId: string) => processGarminOutbox(userId),
  queueGarminStrengthWindowSync: vi.fn().mockResolvedValue(0),
}));

const processGCalOutbox = vi.fn(async (userId: string) => ({
  processed: 0,
  succeeded: 0,
  failed: 0,
  errors: [],
  __userId: userId,
}));
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
vi.mock("../gcal-client", () => ({
  isConnected: vi.fn(async () => connected),
}));

let garminEnabled = true;
vi.mock("../garmin-config", () => ({
  isGarminWorkoutSyncEnabled: vi.fn(async () => garminEnabled),
}));

vi.mock("next/server", () => ({ after: vi.fn() }));

const { drainOutboxNow } = await import("../outbox-drain");

beforeEach(() => {
  vi.clearAllMocks();
  connected = true;
  garminEnabled = true;
  resetStaleClaimsScopes.length = 0;
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
});

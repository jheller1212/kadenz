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
vi.mock("../sync-manager", () => ({
  processGCalOutbox: (userId: string) => processGCalOutbox(userId),
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
});

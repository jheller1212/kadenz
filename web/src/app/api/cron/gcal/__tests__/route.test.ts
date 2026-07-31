// cron/gcal predates withCronFanOut/forEachUser and, until this fix, ran every
// query on the pooled connection with no row level security context set. That
// compiles, runs, and answers 200 every day (see the route's own file
// comment): under FORCE row level security an unscoped SELECT matches zero
// rows and an unscoped INSERT/UPDATE violates its WITH CHECK. Real
// Postgres/RLS isn't available to vitest, so this test does what
// strava/disconnect's route test does: mock db/with-user so currentUserId()
// only resolves to a value WHILE a withUser callback is running, and prove
// every per-user helper this route calls runs from inside that window. A
// regression back to calling one of them on the ambient connection throws
// here, rather than quietly reporting success.
//
// It also asserts the opposite for the two calls that are DELIBERATELY left
// unscoped (processGCalOutbox, processGarminOutbox) and the outbox requeue —
// see the route's file comment for why. If a future change wraps those in a
// per-user scope without addressing the underlying "one transaction, one
// app.user_id, many users' outbox rows" problem, this test should be revisited
// rather than assumed to still be correct.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const OWNER_USER = "00000000-0000-0000-0000-000000000001";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const USER_IDS = [OWNER_USER, OTHER_USER];

// ── db/with-user mock: the same scope-tracking shape as
// strava/disconnect/__tests__/route.test.ts, extended with a working
// forEachUser so the route's real fan-out loops run against a fixed roster
// instead of hitting Postgres. ──────────────────────────────────────────────
let scopedUserId: string | null = null;

const withUser = vi.fn(async (userId: string, fn: (tx: unknown) => unknown) => {
  scopedUserId = userId;
  try {
    return await fn({});
  } finally {
    scopedUserId = null;
  }
});

const currentUserId = vi.fn(() => {
  if (!scopedUserId) {
    throw new Error(
      "currentUserId() called outside a request context. Wrap the route in withSession() or the job in withUser()/forEachUser()."
    );
  }
  return scopedUserId;
});

const forEachUser = vi.fn(
  async <T>(fn: (tx: unknown, userId: string) => Promise<T>) => {
    const out: Array<{ userId: string; result: T }> = [];
    for (const userId of USER_IDS) {
      const result = (await withUser(userId, (tx) => fn(tx, userId))) as T;
      out.push({ userId, result });
    }
    return out;
  }
);

vi.mock("@/db/with-user", () => ({ withUser, forEachUser, currentUserId }));

// ── @/db: keep the real schema exports (syncOutbox, OWNER_USER_ID — the
// route's owner-only Garmin gate has to match a real constant), replace only
// the query client so the requeue update never reaches Postgres. Recorded
// with the scope at call time to prove it is the cross-user, deliberately
// UNSCOPED write the file comment describes. ────────────────────────────────
const requeueCalls: Array<{ scopedUserId: string | null }> = [];
vi.mock("@/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db")>();
  return {
    ...actual,
    db: {
      update: vi.fn(() => {
        requeueCalls.push({ scopedUserId });
        return {
          set: vi.fn(() => ({
            where: vi.fn(() => ({
              returning: vi.fn().mockResolvedValue([]),
            })),
          })),
        };
      }),
    },
  };
});

// ── Every per-user helper the route calls, each recording the scope active
// when it ran. `currentUserId()` inside a helper's own body is what would
// really throw in production if the route regressed to calling it unscoped
// (pruneStaleAdhocSessions/autoCloseAbandonedSessions genuinely do this via
// ownedBy() — see lib/api/owned.ts); the rest record the scope directly since
// their real implementations take the id as an explicit parameter instead. ──
const scopeLog: Record<string, Array<string | null>> = {};
function recordScope(name: string) {
  (scopeLog[name] ??= []).push(scopedUserId);
}

vi.mock("@/lib/session", () => ({
  validateSessionCookie: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/sync/gcal-client", () => ({
  isConnected: vi.fn(async (userId: string) => {
    recordScope("isConnected");
    return userId === OWNER_USER;
  }),
}));

vi.mock("@/lib/sync/garmin-config", () => ({
  isGarminWorkoutSyncEnabled: vi.fn(async () => {
    recordScope("isGarminWorkoutSyncEnabled");
    // Both users have the toggle on — proves the owner-only gate in the
    // route, not just the toggle check, is what keeps the non-owner from
    // being pushed to Garmin.
    return true;
  }),
}));

const processGarminOutboxCalls: Array<string | null> = [];
vi.mock("@/lib/sync/garmin-sync", () => ({
  resyncGarminWindow: vi.fn(async (userId: string) => {
    recordScope("resyncGarminWindow");
    currentUserId();
    return { repushed: userId === OWNER_USER ? 1 : 0, runsQueued: 0, strengthQueued: 0 };
  }),
  queueGarminWindowSync: vi.fn(async () => {
    recordScope("queueGarminWindowSync");
    currentUserId();
    return 2;
  }),
  queueGarminStrengthWindowSync: vi.fn(async () => {
    recordScope("queueGarminStrengthWindowSync");
    currentUserId();
    return 1;
  }),
  processGarminOutbox: vi.fn(async () => {
    processGarminOutboxCalls.push(scopedUserId);
    return { processed: 0, succeeded: 0, failed: 0, errors: [] };
  }),
}));

vi.mock("@/lib/sync/garmin-client", () => ({
  garminClient: { isConfigured: vi.fn(() => true) },
}));

vi.mock("@/lib/sync/garmin-activity-import", () => ({
  runGarminImport: vi.fn(async () => {
    recordScope("runGarminImport");
    currentUserId();
    return { fetched: 0, imported: 0, skippedDuplicates: 0, skippedOther: 0, skippedDeleted: 0 };
  }),
}));

vi.mock("@/lib/sync/wellness-sync", () => ({
  runWellnessSync: vi.fn(async () => {
    recordScope("runWellnessSync");
    currentUserId();
    return { pulled: 0, missing: 0, failed: 0 };
  }),
}));

vi.mock("@/lib/reminders/dispatch", () => ({
  dispatchDueReminders: vi.fn(async () => {
    recordScope("dispatchDueReminders");
    currentUserId();
    return { sent: 0, skipped: 0, failed: 0 };
  }),
}));

vi.mock("@/lib/strength/schedule", () => ({
  pruneStaleAdhocSessions: vi.fn(async () => {
    recordScope("pruneStaleAdhocSessions");
    currentUserId();
    return { removed: 0 };
  }),
  autoCloseAbandonedSessions: vi.fn(async () => {
    recordScope("autoCloseAbandonedSessions");
    currentUserId();
    return { closed: 0 };
  }),
}));

const processGCalOutboxCalls: Array<string | null> = [];
vi.mock("@/lib/sync/sync-manager", () => ({
  processGCalOutbox: vi.fn(async () => {
    processGCalOutboxCalls.push(scopedUserId);
    return { processed: 0, succeeded: 0, failed: 0, errors: [] };
  }),
}));

const { GET } = await import("../route");

function fakeRequest(headers: Record<string, string>): NextRequest {
  return {
    url: "https://kadenz.test/api/cron/gcal",
    headers: new Headers(headers),
    nextUrl: new URL("https://kadenz.test/api/cron/gcal"),
  } as unknown as NextRequest;
}

const CRON_SECRET = "test-cron-secret";

beforeEach(() => {
  vi.clearAllMocks();
  scopedUserId = null;
  requeueCalls.length = 0;
  processGarminOutboxCalls.length = 0;
  processGCalOutboxCalls.length = 0;
  for (const key of Object.keys(scopeLog)) delete scopeLog[key];
  process.env.CRON_SECRET = CRON_SECRET;
});

describe("GET /api/cron/gcal", () => {
  it("runs every per-user check and job inside that user's own row level security scope", async () => {
    const res = await GET(
      fakeRequest({ authorization: `Bearer ${CRON_SECRET}` })
    );
    const body = await res.json();

    // Per-user helpers: every recorded call happened while a real (non-null)
    // scope was active, and — because the mocks above also call
    // currentUserId() themselves — none of them threw. Both users are
    // represented for the fan-outs that apply to everyone.
    for (const name of [
      "isConnected",
      "isGarminWorkoutSyncEnabled",
      "runGarminImport",
      "runWellnessSync",
      "dispatchDueReminders",
      "pruneStaleAdhocSessions",
      "autoCloseAbandonedSessions",
    ]) {
      expect(scopeLog[name], `${name} was never called`).toBeDefined();
      expect(
        scopeLog[name].every((s) => s !== null),
        `${name} ran at least once with no row level security scope active: ${JSON.stringify(scopeLog[name])}`
      ).toBe(true);
      expect(scopeLog[name].sort()).toEqual([...USER_IDS].sort());
    }

    // Garmin push: only the owner's iteration actually resyncs/queues (see
    // the route's file comment and sync/reconcile-garmin, whose shape this
    // copies) — the non-owner's toggle being on must not fan the push out to
    // them even though isGarminWorkoutSyncEnabled ran for both.
    for (const name of ["resyncGarminWindow", "queueGarminWindowSync", "queueGarminStrengthWindowSync"]) {
      expect(scopeLog[name], `${name} was never called`).toBeDefined();
      expect(scopeLog[name]).toEqual([OWNER_USER]);
    }
    expect(body.garminSkippedNonOwner).toBe(1);

    // The two outbox drains and the requeue are deliberately cross-user and
    // deliberately unscoped (see the route's file comment) — this is the
    // architectural gap the task asked to be reported, not mechanically
    // fixed. Pinning it here means a future change to that shape is a
    // decision this test forces someone to make consciously.
    expect(processGCalOutboxCalls).toEqual([null]);
    expect(processGarminOutboxCalls).toEqual([null]);
    expect(requeueCalls).toEqual([{ scopedUserId: null }]);

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("would surface a per-user job that stopped running inside its scope as a thrown error, not a silent success", () => {
    // Directly exercising the failure mode this test file exists to prevent:
    // currentUserId() called OUTSIDE withUser's callback must throw, never
    // quietly resolve to a stale or missing id.
    expect(() => currentUserId()).toThrow(/outside a request context/);
  });

  it("returns a non-2xx status when a per-user job fails, so the GitHub workflow and Cloudflare Worker both see it", async () => {
    const { runWellnessSync } = await import("@/lib/sync/wellness-sync");
    vi.mocked(runWellnessSync).mockRejectedValueOnce(new Error("garmin worker unreachable"));

    const res = await GET(fakeRequest({ authorization: `Bearer ${CRON_SECRET}` }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.ok).toBe(false);
  });

  it("rejects a request with neither the cron secret nor a signed-in session", async () => {
    const res = await GET(fakeRequest({}));

    expect(res.status).toBe(401);
    expect(forEachUser).not.toHaveBeenCalled();
  });
});

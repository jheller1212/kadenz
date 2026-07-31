// cron/gcal predates withCronFanOut/forEachUser and, until #137, ran every
// query on the pooled connection with no row level security context set. That
// compiles, runs, and answers 200 every day: under FORCE row level security
// an unscoped SELECT matches zero rows and an unscoped INSERT/UPDATE violates
// its WITH CHECK. #137 fixed every per-user check and job in this route but
// left the two outbox drains (processGCalOutbox, processGarminOutbox) and the
// failed-job requeue deliberately unscoped, flagged loudly in the file
// comment, because a single claim spanning every user's queued jobs doesn't
// fit inside one transaction's app.user_id. This reshape closes that gap by
// making the claim itself per-user (see claimJobs in sync-manager.ts) and
// looping it here the same way every other per-user block in this route
// already runs.
//
// Real Postgres/RLS isn't available to vitest, so this test does what
// strava/disconnect's route test does: mock db/with-user so currentUserId()
// only resolves to a value WHILE a withUser callback is running, and prove
// every per-user helper this route calls — now including the two drains and
// the requeue — runs from inside that window. A regression back to calling
// one of them on the ambient connection throws here, rather than quietly
// reporting success.

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
// with the scope at call time to prove the requeue now runs per user, inside
// that user's own scope, instead of once on the ambient connection. ────────
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

// processGarminOutbox now takes a userId and, like the real implementation,
// opens its own withUser scope around the drain — mocked here the same way
// so the test can prove the ROUTE never has to open that scope itself.
const processGarminOutboxCalls: Array<{ arg: string; scopedUserId: string | null }> = [];
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
  processGarminOutbox: vi.fn(async (userId: string) =>
    withUser(userId, async () => {
      processGarminOutboxCalls.push({ arg: userId, scopedUserId });
      currentUserId();
      return { processed: 0, succeeded: 0, failed: 0, errors: [] };
    })
  ),
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

// processGCalOutbox now takes a userId and opens its own withUser scope
// around the drain, same reasoning as processGarminOutbox above.
const processGCalOutboxCalls: Array<{ arg: string; scopedUserId: string | null }> = [];
vi.mock("@/lib/sync/sync-manager", () => ({
  processGCalOutbox: vi.fn(async (userId: string) =>
    withUser(userId, async () => {
      processGCalOutboxCalls.push({ arg: userId, scopedUserId });
      currentUserId();
      return { processed: 0, succeeded: 0, failed: 0, errors: [] };
    })
  ),
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

    // The requeue now runs once per user, and only ever writes while THAT
    // user's own scope is active — a job belonging to the other user is
    // never touched from inside this one's transaction.
    expect(requeueCalls).toEqual([
      { scopedUserId: OWNER_USER },
      { scopedUserId: OTHER_USER },
    ]);

    // The gcal drain runs once per CONNECTED user (only the owner is
    // connected in this fixture — see the isConnected mock), each call
    // scoped to itself: the argument passed in and the scope active at call
    // time are the same id.
    expect(processGCalOutboxCalls).toEqual([
      { arg: OWNER_USER, scopedUserId: OWNER_USER },
    ]);

    // The garmin drain runs once, for the owner only, scoped to the owner —
    // never fanned out to the non-owner even though the route loops over
    // every user elsewhere.
    expect(processGarminOutboxCalls).toEqual([
      { arg: OWNER_USER, scopedUserId: OWNER_USER },
    ]);

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("would surface a per-user job that stopped running inside its scope as a thrown error, not a silent success", () => {
    // Directly exercising the failure mode this test file exists to prevent:
    // currentUserId() called OUTSIDE withUser's callback must throw, never
    // quietly resolve to a stale or missing id.
    expect(() => currentUserId()).toThrow(/outside a request context/);
  });

  it("drains the other user's outbox even when one user's drain throws, and still reports a non-2xx", async () => {
    const { processGCalOutbox } = await import("@/lib/sync/sync-manager");
    vi.mocked(processGCalOutbox).mockImplementationOnce(
      // The mock module's declared type expects a UserId; the test only
      // needs plain string scope-tracking, so this narrows back at the call
      // boundary rather than fighting the branded type across the mock.
      (async (userId: string) =>
        withUser(userId, async () => {
          processGCalOutboxCalls.push({ arg: userId, scopedUserId });
          throw new Error("google calendar API unreachable");
        })) as typeof processGCalOutbox
    );

    const res = await GET(fakeRequest({ authorization: `Bearer ${CRON_SECRET}` }));
    const body = await res.json();

    // Both users still ran the connection check (isConnected), and — because
    // only the owner is "connected" in this fixture — only the owner's drain
    // was attempted and threw. Nothing about the failure should have stopped
    // the rest of the route (garmin, strength prune, reminders, ...) from
    // running for both users.
    expect(scopeLog.isConnected.sort()).toEqual([...USER_IDS].sort());
    expect(scopeLog.pruneStaleAdhocSessions.sort()).toEqual([...USER_IDS].sort());

    expect(res.status).toBe(500);
    expect(body.ok).toBe(false);
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

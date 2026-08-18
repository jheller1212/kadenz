// getAuthClient()'s "tokens" listener persists a refreshed access/refresh
// token back to whichever userId the client was built for. Before this was
// threaded through, a closure capturing the wrong (or no) userId would be
// the same cross-user overwrite bug strava-client.ts had, just relocated to
// a refresh instead of the initial connect. Mocks "@/db" (via credentials.ts)
// and "googleapis". No real network, no real DB.

import { describe, it, expect, vi, beforeEach } from "vitest";

const integrationCredentials = { __t: "integrationCredentials" } as Record<string, unknown>;
for (const k of ["userId", "provider", "payload"]) integrationCredentials[k] = k;
const userIntegrationState = { __t: "userIntegrationState" } as Record<string, unknown>;
for (const k of ["userId", "key", "value"]) userIntegrationState[k] = k;

// Two logical tables share this one mock DB: integration_credentials (via
// credentials.ts) and user_integration_state (via user-state.ts). Both go
// through select/insert/delete, so calls are tagged by which table object
// they were built against rather than kept in separate queues.
let selectQueue: unknown[][] = [];
function queueSelect(rows: unknown[]) {
  selectQueue.push(rows);
}

interface InsertCall {
  table: unknown;
  values: unknown;
  conflictTarget?: unknown;
}
const insertCalls: InsertCall[] = [];

interface DeleteCall {
  table: unknown;
}
const deleteCalls: DeleteCall[] = [];

function resetMockDb() {
  selectQueue = [];
  insertCalls.length = 0;
  deleteCalls.length = 0;
}

function chain(resolveTo: unknown) {
  const c: Record<string, unknown> = {
    from: () => c,
    where: () => c,
    limit: () => Promise.resolve(resolveTo),
  };
  return c;
}

// credentials.ts scopes each of its own statements now (integration_credentials
// is tenanted under FORCE row level security, and the sync path deliberately
// runs outside a transaction — see #173/#174). These suites mock the database
// wholesale, so withUser is a pass-through here; its real behaviour is
// db/with-user.ts's own concern.
vi.mock("@/db/with-user", () => ({
  withUser: (_userId: string, fn: () => unknown) => fn(),
}));

vi.mock("@/db", () => ({
  integrationCredentials,
  userIntegrationState,
  db: {
    select: () => ({ from: () => chain(selectQueue.shift() ?? []) }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        const call: InsertCall = { table, values };
        insertCalls.push(call);
        return {
          onConflictDoUpdate: (opts: { target: unknown }) => {
            call.conflictTarget = opts.target;
            return Promise.resolve(undefined);
          },
        };
      },
    }),
    delete: (table: unknown) => ({
      where: () => {
        deleteCalls.push({ table });
        return Promise.resolve(undefined);
      },
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
  and: (...args: unknown[]) => ({ op: "and", args }),
}));

// Minimal OAuth2 fake: captures the "tokens" listener so the test can fire it
// itself, exactly like the real googleapis client would after a refresh.
let tokensListener: ((t: Record<string, unknown>) => void) | null = null;
class FakeOAuth2Client {
  setCredentials() {}
  on(event: string, cb: (t: Record<string, unknown>) => void) {
    if (event === "tokens") tokensListener = cb;
  }
}
vi.mock("googleapis", () => ({
  google: {
    auth: { OAuth2: FakeOAuth2Client },
    calendar: vi.fn(),
    // Real googleapis exposes this; the module sets a global request timeout
    // through it at import time, because gaxios ships with none and a Calendar
    // call that never answers otherwise never returns.
    options: vi.fn(),
  },
}));
vi.mock("@/lib/strength/weights", () => ({ formatLoad: vi.fn() }));

const { getAuthClient, loadTokens, isConnected, markGCalDisconnected, loadGCalConnectionIssue, saveTokens } =
  await import("../gcal-client");

const STORED_TOKENS = {
  access_token: "at-1",
  refresh_token: "rt-1",
  expiry_date: Date.now() + 3600_000,
};

beforeEach(() => {
  resetMockDb();
  tokensListener = null;
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
});

describe("getAuthClient: refresh persists to the same user", () => {
  it("saves a refreshed token set against the SAME userId the client was built for", async () => {
    queueSelect([{ payload: STORED_TOKENS }]); // loadTokens(userId) inside getAuthClient

    const auth = await getAuthClient("11111111-1111-4111-8111-111111111111");
    expect(auth).not.toBeNull();
    expect(tokensListener).not.toBeNull();

    // Simulate googleapis firing a refresh while a DIFFERENT user's client
    // might also be live, the closure must still write to that user's row,
    // not to whichever user happens to be "current" at call time.
    tokensListener!({ access_token: "at-2", refresh_token: "rt-2", expiry_date: Date.now() + 7200_000 });
    // saveTokens() is fire-and-forget inside the listener; flush a tick.
    await new Promise((r) => setTimeout(r, 0));

    expect(insertCalls).toHaveLength(1);
    const values = insertCalls[0].values as Record<string, unknown>;
    expect(values.userId).toBe("11111111-1111-4111-8111-111111111111");
    expect((values.payload as Record<string, unknown>).access_token).toBe("at-2");
  });
});

describe("loadTokens / isConnected: no connection", () => {
  it("returns null / false for a user with no stored row, never throws", async () => {
    queueSelect([]);
    const tokens = await loadTokens("user-with-nothing-connected");
    expect(tokens).toBeNull();

    queueSelect([]);
    const connected = await isConnected("user-with-nothing-connected");
    expect(connected).toBe(false);
  });
});

describe("markGCalDisconnected: a dead grant disconnects, once, with a reason", () => {
  it("forgets the credentials (isConnected's own source of truth) and records why", async () => {
    await markGCalDisconnected("11111111-1111-4111-8111-111111111111", "invalid_grant");

    // Same action a manual Disconnect performs — deleteCredentials — so
    // isConnected() never grows a second notion of "connected".
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0].table).toBe(integrationCredentials);

    // Plus a record of why, for the settings UI to show "needs reconnecting"
    // instead of a plain "never connected".
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].table).toBe(userIntegrationState);
    const values = insertCalls[0].values as Record<string, unknown>;
    expect(values.userId).toBe("11111111-1111-4111-8111-111111111111");
    expect(values.key).toBe("google:connection");
    expect((values.value as Record<string, unknown>).reason).toBe("invalid_grant");
  });
});

describe("loadGCalConnectionIssue", () => {
  it("returns the recorded reason when one exists", async () => {
    queueSelect([{ value: { reason: "invalid_grant", at: "2026-08-01T00:00:00.000Z" } }]);
    const issue = await loadGCalConnectionIssue("11111111-1111-4111-8111-111111111111");
    expect(issue?.reason).toBe("invalid_grant");
  });

  it("returns null for a user who was never disconnected this way", async () => {
    queueSelect([]);
    const issue = await loadGCalConnectionIssue("11111111-1111-4111-8111-111111111111");
    expect(issue).toBeNull();
  });
});

describe("saveTokens: reconnecting clears a prior disconnect record", () => {
  it("deletes the google:connection row alongside saving fresh credentials", async () => {
    await saveTokens("11111111-1111-4111-8111-111111111111", {
      access_token: "at-new",
      refresh_token: "rt-new",
      expiry_date: Date.now() + 3600_000,
    });

    expect(insertCalls).toHaveLength(1); // the credentials save itself
    expect(insertCalls[0].table).toBe(integrationCredentials);
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0].table).toBe(userIntegrationState);
  });
});

// getAuthClient()'s "tokens" listener persists a refreshed access/refresh
// token back to whichever userId the client was built for. Before this was
// threaded through, a closure capturing the wrong (or no) userId would be
// the same cross-user overwrite bug strava-client.ts had, just relocated to
// a refresh instead of the initial connect. Mocks "@/db" (via credentials.ts)
// and "googleapis". No real network, no real DB.

import { describe, it, expect, vi, beforeEach } from "vitest";

const integrationCredentials = { __t: "integrationCredentials" } as Record<string, unknown>;
for (const k of ["userId", "provider", "payload"]) integrationCredentials[k] = k;

let selectQueue: unknown[][] = [];
function queueSelect(rows: unknown[]) {
  selectQueue.push(rows);
}

interface InsertCall {
  values: unknown;
  conflictTarget?: unknown;
}
const insertCalls: InsertCall[] = [];

function resetMockDb() {
  selectQueue = [];
  insertCalls.length = 0;
}

function chain(resolveTo: unknown) {
  const c: Record<string, unknown> = {
    from: () => c,
    where: () => c,
    limit: () => Promise.resolve(resolveTo),
  };
  return c;
}

vi.mock("@/db", () => ({
  integrationCredentials,
  db: {
    select: () => ({ from: () => chain(selectQueue.shift() ?? []) }),
    insert: () => ({
      values: (values: unknown) => {
        const call: InsertCall = { values };
        insertCalls.push(call);
        return {
          onConflictDoUpdate: (opts: { target: unknown }) => {
            call.conflictTarget = opts.target;
            return Promise.resolve(undefined);
          },
        };
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
  },
}));
vi.mock("@/lib/strength/weights", () => ({ formatLoad: vi.fn() }));

const { getAuthClient, loadTokens, isConnected } = await import("../gcal-client");

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

    const auth = await getAuthClient("user-a");
    expect(auth).not.toBeNull();
    expect(tokensListener).not.toBeNull();

    // Simulate googleapis firing a refresh while a DIFFERENT user's client
    // might also be live, the closure must still write to user-a's row,
    // not to whichever user happens to be "current" at call time.
    tokensListener!({ access_token: "at-2", refresh_token: "rt-2", expiry_date: Date.now() + 7200_000 });
    // saveTokens() is fire-and-forget inside the listener; flush a tick.
    await new Promise((r) => setTimeout(r, 0));

    expect(insertCalls).toHaveLength(1);
    const values = insertCalls[0].values as Record<string, unknown>;
    expect(values.userId).toBe("user-a");
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

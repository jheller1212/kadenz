// getAccessToken() refreshes an expiring token and must persist the
// refreshed set against the SAME userId it was called with. A stray
// hardcoded id here would be the exact cross-user overwrite bug Phase 4
// fixes, just moved from initial connect into a refresh. Same mocking
// approach as the other strava-client tests: opaque table tags, scripted
// selects, no real DB.

import { describe, it, expect, vi, beforeEach } from "vitest";

const syncOutbox = { __t: "syncOutbox" } as Record<string, unknown>;
const integrationCredentials = { __t: "integrationCredentials" } as Record<string, unknown>;
for (const t of [syncOutbox, integrationCredentials]) {
  t.idempotencyKey = "idempotencyKey";
  t.payload = "payload";
  t.userId = "userId";
  t.provider = "provider";
}

let selectQueue: unknown[][] = [];
function queueSelect(rows: unknown[]) {
  selectQueue.push(rows);
}

interface InsertCall {
  table: unknown;
  values: unknown;
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
  syncOutbox,
  integrationCredentials,
  db: {
    select: () => ({ from: () => chain(selectQueue.shift() ?? []) }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        insertCalls.push({ table, values });
        return { onConflictDoUpdate: () => Promise.resolve(undefined) };
      },
    }),
  },
}));

// Spread the real module rather than listing exports: an exhaustive mock breaks
// whenever anything in the imported module graph uses a different drizzle
// export, which is how this one broke on `relations` (used by db/schema.ts, and
// never mentioned in this file).
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
  and: (...args: unknown[]) => ({ op: "and", args }),
}));

// strava-client.ts also imports these; not exercised by getAccessToken/refresh.
vi.mock("@/lib/sync/gcal-client", () => ({ isConnected: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/sync/sync-manager", () => ({ queueStrengthSessionSync: vi.fn() }));

const { getAccessToken } = await import("../strava-client");

const USER_A = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  resetMockDb();
  global.fetch = vi.fn();
  process.env.STRAVA_CLIENT_ID = "test-client-id";
  process.env.STRAVA_CLIENT_SECRET = "test-client-secret";
});

describe("getAccessToken: refresh persists to the same user", () => {
  it("refreshes an expiring token and saves the new one against the SAME userId, never a different one", async () => {
    const expiringSoon = {
      access_token: "at-old",
      refresh_token: "rt-old",
      expires_at: Math.floor(Date.now() / 1000) + 60, // inside the 5-minute refresh window
      athlete_id: 42,
    };
    queueSelect([{ payload: expiringSoon }]); // loadTokens(USER_A)

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "at-new",
        refresh_token: "rt-new",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      }),
    });

    const token = await getAccessToken(USER_A);
    expect(token).toBe("at-new");

    expect(insertCalls).toHaveLength(1);
    const values = insertCalls[0].values as Record<string, unknown>;
    expect(values.userId).toBe(USER_A);
    expect((values.payload as Record<string, unknown>).access_token).toBe("at-new");
    // The athlete id survives the refresh (Strava's refresh response carries
    // no athlete object), it's the providerAccountId the webhook depends on.
    expect((values.payload as Record<string, unknown>).athlete_id).toBe(42);
  });

  it("throws rather than fabricating a token for a user with no connection", async () => {
    queueSelect([]); // loadTokens(USER_A): no row
    await expect(getAccessToken(USER_A)).rejects.toThrow("Strava not connected");
    expect(insertCalls).toHaveLength(0);
  });
});

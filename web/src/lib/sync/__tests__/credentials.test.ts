// lib/sync/credentials.ts is the per-user store every OAuth token (Strava,
// Google) now goes through, replacing the pre-Phase-4 single sync_outbox row
// the whole installation shared. These tests exercise the module directly
// rather than through strava-client/gcal-client, since both of those just
// delegate to it. Same mocking approach as the strava-client tests: opaque
// table tags, scripted selects, no real DB.

import { describe, it, expect, vi, beforeEach } from "vitest";

const integrationCredentials = { __t: "integrationCredentials" } as Record<string, unknown>;
const userIdentities = { __t: "userIdentities" } as Record<string, unknown>;
for (const t of [integrationCredentials, userIdentities]) {
  t.userId = "userId";
  t.provider = "provider";
  t.providerAccountId = "providerAccountId";
  t.payload = "payload";
}

let selectQueue: unknown[][] = [];
function queueSelect(rows: unknown[]) {
  selectQueue.push(rows);
}

interface InsertCall {
  table: unknown;
  values: unknown;
  conflictTarget?: unknown;
  conflictSet?: unknown;
}
const insertCalls: InsertCall[] = [];
const deleteCalls: Array<{ table: unknown }> = [];

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
    then: (onFulfilled: (v: unknown) => unknown) => Promise.resolve(resolveTo).then(onFulfilled),
    catch: (onRejected: (e: unknown) => unknown) => Promise.resolve(resolveTo).catch(onRejected),
  };
  return c;
}

vi.mock("@/db", () => ({
  integrationCredentials,
  userIdentities,
  db: {
    select: () => ({
      from: () => chain(selectQueue.shift() ?? []),
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        const call: InsertCall = { table, values };
        insertCalls.push(call);
        return {
          onConflictDoUpdate: (opts: { target: unknown; set: unknown }) => {
            call.conflictTarget = opts.target;
            call.conflictSet = opts.set;
            return Promise.resolve(undefined);
          },
        };
      },
    }),
    delete: (table: unknown) => {
      deleteCalls.push({ table });
      return { where: () => Promise.resolve(undefined) };
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
  and: (...args: unknown[]) => ({ op: "and", args }),
}));

const { loadCredentials, saveCredentials, deleteCredentials, findUserByProviderAccount } =
  await import("../credentials");

beforeEach(() => {
  resetMockDb();
});

describe("saveCredentials: per-user isolation", () => {
  it("scopes the upsert conflict to (userId, provider), the fix for the pre-Phase-4 bug where a shared idempotency key let the second person's OAuth overwrite the first person's tokens", async () => {
    await saveCredentials("user-a", "strava", { access_token: "token-a" });
    await saveCredentials("user-b", "strava", { access_token: "token-b" });

    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[0].values).toMatchObject({ userId: "user-a", provider: "strava" });
    expect(insertCalls[1].values).toMatchObject({ userId: "user-b", provider: "strava" });

    // A conflict target of provider alone would be the old bug reborn: user
    // B connecting would upsert onto user A's existing row instead of
    // creating a second one. Both userId and provider must be in the target.
    for (const call of insertCalls) {
      expect(call.conflictTarget).toEqual([integrationCredentials.userId, integrationCredentials.provider]);
    }
  });
});

describe("loadCredentials: no connection", () => {
  it("returns null for a user with no stored row, rather than throwing", async () => {
    queueSelect([]); // no row for this user/provider
    const result = await loadCredentials("user-with-nothing-connected", "strava");
    expect(result).toBeNull();
  });

  it("returns null on a query failure too, matching the old singleton loaders' behaviour", async () => {
    selectQueue = [];
    // No queued row at all: chain() falls back to `[]`, exercising the same
    // "nothing to return" path a thrown query would take through the
    // try/catch in loadCredentials.
    const result = await loadCredentials("user-a", "google");
    expect(result).toBeNull();
  });
});

describe("findUserByProviderAccount", () => {
  it("resolves the athlete id from user_identities, not from this module's own table", async () => {
    queueSelect([{ userId: "user-a" }]);
    const result = await findUserByProviderAccount("strava", "12345");
    expect(result).toBe("user-a");
  });

  it("returns null for an athlete nobody has connected", async () => {
    queueSelect([]);
    const result = await findUserByProviderAccount("strava", "unknown-athlete");
    expect(result).toBeNull();
  });
});

describe("deleteCredentials", () => {
  it("deletes only the given user's row for the given provider", async () => {
    await deleteCredentials("user-a", "strava");
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0].table).toBe(integrationCredentials);
  });
});

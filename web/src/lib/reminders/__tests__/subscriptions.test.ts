// A push_subscriptions row carries two facts that arrived from two separate
// pieces of work: whose device it is (user_id) and how to reach it
// (transport, and the key pair or lack of one that goes with it).
//
// These tests exist because the two were developed on branches that did not
// see each other, and a merge that satisfied only one of them would still
// compile, still pass every other test, and still look healthy in the app.
// Getting the owner wrong sends a notification to the wrong person; getting
// the transport wrong sends it nowhere.
//
// Same mocking convention as the other DB tests here: vi.mock("@/db") with an
// opaque table tag, and the module under test imported after the mock.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { asUserId } from "@/lib/user-id";

const pushSubscriptions = { __t: "pushSubscriptions" } as Record<string, unknown>;
for (const col of ["id", "endpoint", "p256dh", "auth", "transport", "userId"]) {
  pushSubscriptions[col] = col;
}

let insertValues: Record<string, unknown> | null = null;
let conflictSet: Record<string, unknown> | null = null;
let selectWhere: unknown = null;
let selectRows: unknown[] = [];

vi.mock("@/db", () => ({
  pushSubscriptions,
  db: {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        insertValues = values;
        return {
          onConflictDoUpdate: (arg: { set: Record<string, unknown> }) => {
            conflictSet = arg.set;
            return Promise.resolve(undefined);
          },
        };
      },
    }),
    select: () => ({
      from: () => ({
        where: (w: unknown) => {
          selectWhere = w;
          return Promise.resolve(selectRows);
        },
      }),
    }),
    delete: () => ({ where: () => Promise.resolve(undefined) }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
  and: (...args: unknown[]) => ({ op: "and", args }),
  inArray: (a: unknown, b: unknown) => ({ op: "inArray", a, b }),
  relations: () => ({}),
}));

const { saveSubscription, listSubscriptions } = await import("../subscriptions");

const USER_A = asUserId("aaaaaaaa-0000-0000-0000-000000000001");
const USER_B = asUserId("bbbbbbbb-0000-0000-0000-000000000002");

beforeEach(() => {
  insertValues = null;
  conflictSet = null;
  selectWhere = null;
  selectRows = [];
});

describe("saveSubscription", () => {
  it("stores a web subscription with its owner, its transport and its keys", async () => {
    await saveSubscription(USER_A, {
      transport: "web",
      endpoint: "https://push.example/a-phone",
      p256dh: "keyA",
      auth: "authA",
    });

    expect(insertValues).toMatchObject({
      endpoint: "https://push.example/a-phone",
      transport: "web",
      userId: USER_A,
      p256dh: "keyA",
      auth: "authA",
    });
  });

  it("stores a native subscription with null keys, which FCM has no equivalent of", async () => {
    await saveSubscription(USER_A, { transport: "fcm", endpoint: "fcm-token-123" });

    expect(insertValues).toMatchObject({
      endpoint: "fcm-token-123",
      transport: "fcm",
      userId: USER_A,
      p256dh: null,
      auth: null,
    });
  });

  it("reassigns ownership when an endpoint is re-subscribed by someone else", async () => {
    // Endpoints are unique table-wide, so a device that changes hands (a
    // shared browser profile, a handed-down phone) would otherwise keep
    // delivering the previous athlete's reminders forever.
    await saveSubscription(USER_B, {
      transport: "web",
      endpoint: "https://push.example/a-phone",
      p256dh: "keyB",
      auth: "authB",
    });

    expect(conflictSet).toMatchObject({ userId: USER_B, p256dh: "keyB", auth: "authB" });
  });

  it("rewrites the transport on conflict, so a row cannot keep a stale one", async () => {
    // A device that was a web subscription and is now the native shell must
    // not keep transport 'web' while holding an FCM token, which would send
    // an FCM token to web-push and silently deliver nothing.
    await saveSubscription(USER_A, { transport: "fcm", endpoint: "shared-endpoint" });

    expect(conflictSet).toMatchObject({ transport: "fcm", p256dh: null, auth: null });
  });
});

describe("listSubscriptions", () => {
  it("asks only for the given user's rows", async () => {
    await listSubscriptions(USER_A);

    expect(selectWhere).toEqual({
      op: "eq",
      a: "userId",
      b: USER_A,
    });
  });

  it("maps each row to the shape its transport implies", async () => {
    selectRows = [
      {
        endpoint: "https://push.example/a-phone",
        p256dh: "keyA",
        auth: "authA",
        transport: "web",
      },
      { endpoint: "fcm-token-123", p256dh: null, auth: null, transport: "fcm" },
    ];

    expect(await listSubscriptions(USER_A)).toEqual([
      {
        transport: "web",
        endpoint: "https://push.example/a-phone",
        p256dh: "keyA",
        auth: "authA",
      },
      { transport: "fcm", endpoint: "fcm-token-123" },
    ]);
  });

  it("drops a web row with no key pair rather than throwing inside the cron loop", async () => {
    // Unreachable for rows written after the 0055 CHECK constraint, but a
    // pre-constraint leftover must not take the whole dispatch run down.
    selectRows = [
      { endpoint: "https://push.example/broken", p256dh: null, auth: null, transport: "web" },
    ];

    expect(await listSubscriptions(USER_A)).toEqual([]);
  });
});

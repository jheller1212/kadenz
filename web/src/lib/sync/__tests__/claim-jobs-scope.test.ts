// claimJobs used to claim across every user's pending rows in one call — the
// exact shape FORCE row level security refuses once the caller carries a
// single app.user_id. This proves, against the REAL claimJobs/processGCalOutbox
// implementation (not a mock of them), that:
//   - the claim query is filtered to the SAME user the enclosing withUser
//     scope is for (the explicit user_id filter processGCalOutbox's own
//     comment describes as "backed by row level security" — RLS isn't
//     available to vitest, so this is the part that IS checkable here);
//   - the claim only ever runs while that scope is open, never before
//     withUser is entered or after it exits — mirroring #135/#137's "mock
//     db/with-user so a call outside a scope throws" pattern, so a
//     regression back to an unscoped call fails loudly here.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { asUserId } from "@/lib/user-id";

const USER_A = asUserId("00000000-0000-0000-0000-000000000001");
const USER_B = asUserId("22222222-2222-4222-8222-222222222222");

let scopedUserId: string | null = null;
const withUser = vi.fn(async (userId: string, fn: () => unknown) => {
  scopedUserId = userId;
  try {
    return await fn();
  } finally {
    scopedUserId = null;
  }
});
vi.mock("@/db/with-user", () => ({ withUser }));

type ExecuteCall = { scopedUserIdAtCallTime: string | null; chunks: unknown[] };
const executeCalls: ExecuteCall[] = [];

vi.mock("@/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db")>();
  return {
    ...actual,
    db: {
      execute: vi.fn(async (query: { queryChunks: unknown[] }) => {
        executeCalls.push({
          scopedUserIdAtCallTime: scopedUserId,
          chunks: query.queryChunks,
        });
        return [];
      }),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([]),
          })),
        })),
      })),
    },
  };
});

const { claimJobs, processGCalOutbox } = await import("../sync-manager");

beforeEach(() => {
  vi.clearAllMocks();
  executeCalls.length = 0;
  scopedUserId = null;
});

describe("claimJobs", () => {
  it("filters the claim to one user's rows", async () => {
    await claimJobs("gcal", USER_A, 50);

    expect(executeCalls).toHaveLength(1);
    // The raw values interpolated into the sql`` template appear directly in
    // queryChunks (see drizzle-orm's SQL shape) — this asserts the actual
    // user id, not just "some filter exists".
    expect(executeCalls[0].chunks).toContain(USER_A);
    expect(executeCalls[0].chunks).toContain("gcal");
  });
});

describe("processGCalOutbox", () => {
  it("claims a user's jobs only while that user's own withUser scope is open", async () => {
    await processGCalOutbox(USER_A);

    expect(withUser).toHaveBeenCalledWith(USER_A, expect.any(Function));
    // resetStaleClaims + claimJobs both hit db.execute/db.update; every call
    // recorded a non-null scope, and every one of them matches USER_A — never
    // USER_B, never null.
    for (const call of executeCalls) {
      expect(call.scopedUserIdAtCallTime).toBe(USER_A);
    }
  });

  it("never lets user B's claim run while scoped to user A, across back-to-back drains", async () => {
    await processGCalOutbox(USER_A);
    const afterA = executeCalls.map((c) => c.scopedUserIdAtCallTime);

    await processGCalOutbox(USER_B);
    const afterB = executeCalls.slice(afterA.length).map((c) => c.scopedUserIdAtCallTime);

    expect(afterA.every((s) => s === USER_A)).toBe(true);
    expect(afterB.every((s) => s === USER_B)).toBe(true);
  });
});

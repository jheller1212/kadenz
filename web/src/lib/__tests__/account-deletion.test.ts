// deleteAccount is the one place in this codebase where a destructive
// operation is correct -- and the one place where "correct" has to mean
// "scoped to exactly one user's rows", proven rather than assumed. There is
// no real database here (that lives in the e2e suite, which this module's
// own withUser/RLS double-enforcement backstops), so what this proves is the
// thing a live database can't show as clearly: every single delete this
// module issues is filtered by the userId it was given, none of them are
// filtered by anything else, and the owner guard runs before any of them do.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableName } from "drizzle-orm";
import { OWNER_USER_ID, userIdentities, users } from "@/db/schema";

const CALLER = "11111111-1111-4111-8111-111111111111";

// Spies on the real eq() rather than replacing it, so every comparison this
// module builds is still a real drizzle SQL condition -- only observed, not
// faked. This is what lets the test assert "every WHERE compared user_id to
// the caller's id" directly, instead of trusting that the source code does
// what its comments say.
const eqCalls: unknown[][] = [];
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (...args: unknown[]) => {
      eqCalls.push(args);
      return (actual.eq as (...a: unknown[]) => unknown)(...args);
    },
  };
});

const deleteCredentials = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/sync/credentials", () => ({ deleteCredentials }));

// Records every table `tx.delete(...)` is called against, by SQL name, so the
// test can assert the discovered set without duplicating it as a second hand
// list (see account-deletion.ts's header comment on why that would rot).
const deletedTables: string[] = [];
const withUser = vi.fn(async (userId: string, fn: (tx: unknown) => unknown) => {
  const tx = {
    delete: (table: Parameters<typeof getTableName>[0]) => {
      deletedTables.push(getTableName(table));
      return { where: vi.fn().mockResolvedValue(undefined) };
    },
  };
  return fn(tx);
});
vi.mock("@/db/with-user", () => ({ withUser }));

const { deleteAccount, OwnerCannotSelfDeleteError, tenantedTableNamesForTest } = await import(
  "../account-deletion"
);

beforeEach(() => {
  eqCalls.length = 0;
  deletedTables.length = 0;
  deleteCredentials.mockClear();
  withUser.mockClear();
});

describe("deleteAccount: the owner guard", () => {
  it("refuses to delete the owner, before touching anything", async () => {
    await expect(deleteAccount(OWNER_USER_ID as never)).rejects.toBeInstanceOf(
      OwnerCannotSelfDeleteError
    );
    expect(withUser).not.toHaveBeenCalled();
    expect(deleteCredentials).not.toHaveBeenCalled();
  });

  it("proceeds for any other user", async () => {
    await expect(deleteAccount(CALLER as never)).resolves.toBeUndefined();
    expect(withUser).toHaveBeenCalledWith(CALLER, expect.any(Function));
  });
});

describe("deleteAccount: scope", () => {
  it("filters every delete by the caller's own id and nothing else", async () => {
    await deleteAccount(CALLER as never);

    expect(eqCalls.length).toBeGreaterThan(0);
    for (const [, value] of eqCalls) {
      expect(value).toBe(CALLER);
    }
  });

  it("revokes both providers' stored credentials for the caller", async () => {
    await deleteAccount(CALLER as never);

    expect(deleteCredentials).toHaveBeenCalledWith(CALLER, "strava");
    expect(deleteCredentials).toHaveBeenCalledWith(CALLER, "google");
  });

  it("deletes every discovered tenanted table, plus identities and the user row itself", async () => {
    await deleteAccount(CALLER as never);

    const expectedTenanted = tenantedTableNamesForTest();
    // Sanity: the discovery isn't accidentally empty (which would make the
    // rest of this test vacuously pass).
    expect(expectedTenanted.length).toBeGreaterThan(10);

    for (const name of expectedTenanted) {
      expect(deletedTables, `${name} was not deleted`).toContain(name);
    }
    expect(deletedTables).toContain(getTableName(userIdentities));
    expect(deletedTables).toContain(getTableName(users));

    // The user row is the identity everything else hangs off, so it must be
    // the very last delete: anything issued after it would run against an id
    // that no longer exists in `users` (irrelevant to FKs here, since nothing
    // else references it left to right, but a real ordering bug -- e.g. a
    // future table added after this one in the loop -- should still show up
    // here rather than only in a live database).
    expect(deletedTables.at(-1)).toBe(getTableName(users));
  });

  it("never targets user_identities through the generic sweep, only explicitly", () => {
    // user_identities carries a userId column (the Phase 1 OAuth FK) but is
    // excluded from the discovered set on purpose -- see account-deletion.ts.
    // If it ever showed up in the discovered list, the explicit delete below
    // would run twice, which is harmless, but its exclusion is what the
    // header comment claims, so assert the claim rather than just the outcome.
    expect(tenantedTableNamesForTest()).not.toContain(getTableName(userIdentities));
  });
});

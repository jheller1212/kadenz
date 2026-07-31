// resolveUserForEmailLogin is the one place a magic-link consume decides
// which user id a session gets minted for. Same mocking convention as
// subscriptions.test.ts: an in-memory store, opaque column tags, and real
// drizzle-orm operator shapes interpreted generically.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { asUserId } from "@/lib/user-id";

// Not imported from @/db/schema: that module pulls in the full drizzle-orm
// surface (pgTable, sql tagged templates, etc.), which this file's shallow
// drizzle-orm mock below does not provide. The value itself is stable and
// documented at its real definition in db/schema.ts.
const OWNER_USER_ID = "00000000-0000-0000-0000-000000000001";

const users: Record<string, string> = { id: "id", email: "email" };
const userIdentities: Record<string, string> = {
  id: "id",
  userId: "userId",
  provider: "provider",
  providerAccountId: "providerAccountId",
  email: "email",
  lastLoginAt: "lastLoginAt",
};

interface IdentityRow {
  id: string;
  userId: string;
  provider: string;
  providerAccountId: string;
  email: string | null;
  lastLoginAt: Date | null;
}

let identityStore: IdentityRow[] = [];
let userStore: Array<{ id: string; email: string | null }> = [];
let nextUserId = 1000;
let nextIdentityId = 1;

type Cond =
  | { op: "and"; args: Cond[] }
  | { op: "eq"; a: string; b: unknown }
  | { op: "ne"; a: string; b: unknown };

function matches<T extends Record<string, unknown>>(row: T, cond: Cond): boolean {
  switch (cond.op) {
    case "and":
      return cond.args.every((c) => matches(row, c));
    case "eq":
      return row[cond.a] === cond.b;
    case "ne":
      return row[cond.a] !== cond.b;
  }
}

function project<T extends Record<string, unknown>>(row: T, fields: Record<string, string>) {
  const out: Record<string, unknown> = {};
  for (const [key, col] of Object.entries(fields)) out[key] = row[col];
  return out;
}

function fakeUuid(n: number): string {
  return `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
}

// users.ts imports `users`, `userIdentities` and `OWNER_USER_ID` straight
// from "@/db/schema" (not through the "@/db" barrel, which re-exports the
// same names alongside the live client) -- both specifiers need the same
// table tags mocked, or the real schema.ts loads and pulls in drizzle-orm's
// full surface (pgTable, `sql` tagged templates, ...) that this file's
// shallow drizzle-orm mock below does not provide.
vi.mock("@/db/schema", () => ({ users, userIdentities, OWNER_USER_ID }));

vi.mock("@/db", () => ({
  users,
  userIdentities,
  db: {
    select: (fields: Record<string, string>) => ({
      from: (table: Record<string, string>) => ({
        where: (cond: Cond) => {
          const rows =
            table === userIdentities
              ? identityStore.filter((r) => matches(r as unknown as Record<string, unknown>, cond))
              : [];
          const withLimit = {
            limit: (n: number) => Promise.resolve(rows.slice(0, n).map((r) => project(r as unknown as Record<string, unknown>, fields))),
          };
          return Object.assign(Promise.resolve(rows.map((r) => project(r as unknown as Record<string, unknown>, fields))), withLimit);
        },
      }),
    }),
    selectDistinct: (fields: Record<string, string>) => ({
      from: () => ({
        where: (cond: Cond) => ({
          limit: (n: number) => {
            const matched = identityStore.filter((r) => matches(r as unknown as Record<string, unknown>, cond));
            const distinct = [...new Map(matched.map((r) => [r.userId, r])).values()];
            return Promise.resolve(distinct.slice(0, n).map((r) => project(r as unknown as Record<string, unknown>, fields)));
          },
        }),
      }),
    }),
    update: () => ({
      set: (setVals: Record<string, unknown>) => ({
        where: (cond: Cond) => {
          const matched = identityStore.filter((r) => matches(r as unknown as Record<string, unknown>, cond));
          for (const r of matched) Object.assign(r, setVals);
          return Promise.resolve(undefined);
        },
      }),
    }),
    insert: (table: Record<string, string>) => ({
      values: (v: Record<string, unknown>) => {
        if (table === users) {
          const row = { id: fakeUuid(nextUserId++), email: (v.email as string) ?? null };
          userStore.push(row);
          return {
            returning: (fields: Record<string, string>) => Promise.resolve([project(row, fields)]),
          };
        }
        // userIdentities insert
        const row: IdentityRow = {
          id: `identity-${nextIdentityId++}`,
          userId: v.userId as string,
          provider: v.provider as string,
          providerAccountId: v.providerAccountId as string,
          email: (v.email as string) ?? null,
          lastLoginAt: (v.lastLoginAt as Date) ?? null,
        };
        return {
          onConflictDoUpdate: (arg: { set: Record<string, unknown> }) => {
            const existing = identityStore.find(
              (r) => r.provider === row.provider && r.providerAccountId === row.providerAccountId
            );
            if (existing) Object.assign(existing, arg.set);
            else identityStore.push(row);
            return Promise.resolve(undefined);
          },
        };
      },
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: string, b: unknown) => ({ op: "eq", a, b }),
  ne: (a: string, b: unknown) => ({ op: "ne", a, b }),
  and: (...args: Cond[]) => ({ op: "and", args }),
}));

const { resolveUserForEmailLogin, EmailSignupClosedError } = await import("../users");

beforeEach(() => {
  identityStore = [];
  userStore = [];
  nextUserId = 1000;
  nextIdentityId = 1;
});

describe("resolveUserForEmailLogin", () => {
  it("refuses a brand new address when sign-up is closed", async () => {
    await expect(resolveUserForEmailLogin("new@example.com", false)).rejects.toBeInstanceOf(
      EmailSignupClosedError
    );
    expect(userStore).toEqual([]);
  });

  it("creates a new, non-owner user for a brand new address when sign-up is open", async () => {
    const userId = await resolveUserForEmailLogin("new@example.com", true);
    expect(userId).not.toBe(OWNER_USER_ID);
    expect(userStore).toHaveLength(1);
    expect(identityStore).toContainEqual(
      expect.objectContaining({ provider: "email", providerAccountId: "new@example.com", userId })
    );
  });

  it("never resolves as the owner, even for an address matching the owner's shape", async () => {
    // There is no owner-email env check anywhere in this path -- asserted by
    // running with signup open and confirming the id minted is a fresh user,
    // never OWNER_USER_ID, regardless of what the address looks like.
    const userId = await resolveUserForEmailLogin("owner@example.com", true);
    expect(userId).not.toBe(OWNER_USER_ID);
  });

  it("logs an existing email identity back in without checking the gate", async () => {
    identityStore.push({
      id: "identity-existing",
      userId: fakeUuid(99),
      provider: "email",
      providerAccountId: "returning@example.com",
      email: "returning@example.com",
      lastLoginAt: null,
    });

    const userId = await resolveUserForEmailLogin("returning@example.com", false);
    expect(userId).toBe(asUserId(fakeUuid(99)));
  });

  it("attaches to the same user as an existing verified (non-email) identity sharing the address", async () => {
    identityStore.push({
      id: "identity-google",
      userId: fakeUuid(42),
      provider: "google",
      providerAccountId: "google-sub-123",
      email: "shared@example.com",
      lastLoginAt: null,
    });

    // Signup closed: this must still succeed, because it is not a new
    // account, it is a new way in to an existing one.
    const userId = await resolveUserForEmailLogin("shared@example.com", false);
    expect(userId).toBe(asUserId(fakeUuid(42)));
    expect(identityStore).toContainEqual(
      expect.objectContaining({ provider: "email", providerAccountId: "shared@example.com", userId: fakeUuid(42) })
    );
  });

  it("refuses to guess and creates a new account when the address is ambiguous across users", async () => {
    // Ids far outside the auto-created range (nextUserId starts at 1 each
    // test) so a freshly created user's id cannot coincidentally collide with
    // one of these and mask a real bug.
    identityStore.push(
      {
        id: "identity-1",
        userId: fakeUuid(101),
        provider: "google",
        providerAccountId: "sub-1",
        email: "ambiguous@example.com",
        lastLoginAt: null,
      },
      {
        id: "identity-2",
        userId: fakeUuid(102),
        provider: "google",
        providerAccountId: "sub-2",
        email: "ambiguous@example.com",
        lastLoginAt: null,
      }
    );

    const userId = await resolveUserForEmailLogin("ambiguous@example.com", true);
    expect(userId).not.toBe(fakeUuid(101));
    expect(userId).not.toBe(fakeUuid(102));
    expect(userStore).toHaveLength(1);
  });
});

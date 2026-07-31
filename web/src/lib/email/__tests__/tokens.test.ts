// Same mocking convention as src/lib/reminders/__tests__/subscriptions.test.ts:
// vi.mock("@/db") with an opaque table tag (columns mapped to their own
// names) and a tiny in-memory store, so `where` clauses built from real
// drizzle-orm operators can be interpreted generically rather than one
// hand-written mock per query shape.
//
// hmacSign/hmacVerify are NOT mocked -- they are Web Crypto, run for real, so
// these tests exercise the actual constant-time comparison path, not a stand-in
// for it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const emailLoginTokens: Record<string, string> = {};
for (const col of ["id", "email", "tokenHash", "requestedIp", "createdAt", "expiresAt", "consumedAt"]) {
  emailLoginTokens[col] = col;
}

interface Row {
  id: string;
  email: string;
  tokenHash: string;
  requestedIp: string | null;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
}

let store: Row[] = [];
let nextId = 1;

type Cond =
  | { op: "and"; args: Cond[] }
  | { op: "eq"; a: string; b: unknown }
  | { op: "isNull"; a: string }
  | { op: "gt"; a: string; b: unknown };

function matches(row: Row, cond: Cond): boolean {
  const r = row as unknown as Record<string, unknown>;
  switch (cond.op) {
    case "and":
      return cond.args.every((c) => matches(row, c));
    case "eq":
      return r[cond.a] === cond.b;
    case "isNull":
      return r[cond.a] == null;
    case "gt":
      return (r[cond.a] as Date).getTime() > (cond.b as Date).getTime();
  }
}

function project(row: Row, fields: Record<string, string>): Record<string, unknown> {
  const r = row as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, col] of Object.entries(fields)) out[key] = r[col];
  return out;
}

vi.mock("@/db", () => ({
  emailLoginTokens,
  db: {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        store.push({
          id: `id-${nextId++}`,
          email: v.email as string,
          tokenHash: v.tokenHash as string,
          requestedIp: (v.requestedIp as string | null) ?? null,
          createdAt: new Date(),
          expiresAt: v.expiresAt as Date,
          consumedAt: null,
        });
        return Promise.resolve(undefined);
      },
    }),
    select: (fields: Record<string, string>) => ({
      from: () => ({
        where: (cond: Cond) =>
          Promise.resolve(store.filter((r) => matches(r, cond)).map((r) => project(r, fields))),
      }),
    }),
    update: () => ({
      set: (setVals: Partial<Row>) => ({
        where: (cond: Cond) => ({
          returning: (fields: Record<string, string>) => {
            const matched = store.filter((r) => matches(r, cond));
            for (const r of matched) Object.assign(r, setVals);
            return Promise.resolve(matched.map((r) => project(r, fields)));
          },
        }),
      }),
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: string, b: unknown) => ({ op: "eq", a, b }),
  and: (...args: Cond[]) => ({ op: "and", args }),
  isNull: (a: string) => ({ op: "isNull", a }),
  gt: (a: string, b: unknown) => ({ op: "gt", a, b }),
}));

const { createEmailLoginToken, consumeEmailLoginToken, normalizeEmail } = await import("../tokens");

beforeEach(() => {
  store = [];
  nextId = 1;
  process.env.SESSION_SECRET = "test-secret-do-not-use-in-prod";
});

afterEach(() => {
  delete process.env.SESSION_SECRET;
  vi.useRealTimers();
});

describe("normalizeEmail", () => {
  it("trims and lower-cases", () => {
    expect(normalizeEmail("  Runner@Example.com  ")).toBe("runner@example.com");
  });
});

describe("createEmailLoginToken / consumeEmailLoginToken", () => {
  it("consumes a fresh token and resolves to the normalized address", async () => {
    const token = await createEmailLoginToken("Runner@Example.com", "203.0.113.1");
    const result = await consumeEmailLoginToken("runner@example.com", token);
    expect(result).toEqual({ ok: true, email: "runner@example.com" });
  });

  it("is single use -- a second consume of the same token fails", async () => {
    const token = await createEmailLoginToken("runner@example.com", null);
    const first = await consumeEmailLoginToken("runner@example.com", token);
    expect(first.ok).toBe(true);

    const second = await consumeEmailLoginToken("runner@example.com", token);
    expect(second).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects an expired token", async () => {
    const token = await createEmailLoginToken("runner@example.com", null);
    // Push the stored row's expiry into the past without touching real time,
    // so this is a property of the row, not of the clock.
    store[0].expiresAt = new Date(Date.now() - 1000);

    const result = await consumeEmailLoginToken("runner@example.com", token);
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a tampered token that doesn't match any stored hash", async () => {
    await createEmailLoginToken("runner@example.com", null);

    const result = await consumeEmailLoginToken("runner@example.com", "not-the-real-token");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects a token presented against the wrong address", async () => {
    const token = await createEmailLoginToken("runner@example.com", null);

    const result = await consumeEmailLoginToken("someone-else@example.com", token);
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("never matches a token against a different address's row, even with the right token value", async () => {
    // Two addresses, both requesting around the same time -- the wrong-address
    // lookup above proves the query narrows by email; this proves a match
    // still requires BOTH the right email and the right token, not either
    // alone letting the other slide.
    const tokenA = await createEmailLoginToken("a@example.com", null);
    await createEmailLoginToken("b@example.com", null);

    const result = await consumeEmailLoginToken("b@example.com", tokenA);
    expect(result.ok).toBe(false);
  });
});

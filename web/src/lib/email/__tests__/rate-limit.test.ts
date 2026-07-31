import { describe, expect, it, vi } from "vitest";
import {
  EMAIL_ADDRESS_LIMIT,
  EMAIL_IP_LIMIT,
  isRateLimited,
} from "../rate-limit";

describe("isRateLimited", () => {
  it("is false below the limit", () => {
    expect(isRateLimited(0, 3)).toBe(false);
    expect(isRateLimited(2, 3)).toBe(false);
  });

  it("trips at and above the limit", () => {
    expect(isRateLimited(3, 3)).toBe(true);
    expect(isRateLimited(4, 3)).toBe(true);
  });
});

// checkEmailRateLimit itself is a thin DB-counting wrapper around
// isRateLimited -- mocked here just enough to prove it trips on the counts
// it's given, using the same vi.mock("@/db") convention as tokens.test.ts.
describe("checkEmailRateLimit", () => {
  it("refuses once the per-address count reaches the limit, before ever counting the IP", async () => {
    vi.resetModules();
    vi.doMock("@/db", () => ({
      emailLoginTokens: { email: "email", requestedIp: "requestedIp", createdAt: "createdAt" },
      db: {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([{ value: EMAIL_ADDRESS_LIMIT }]),
          }),
        }),
      },
    }));
    vi.doMock("drizzle-orm", () => ({
      and: (...args: unknown[]) => ({ op: "and", args }),
      eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
      gte: (a: unknown, b: unknown) => ({ op: "gte", a, b }),
      isNotNull: (a: unknown) => ({ op: "isNotNull", a }),
      count: () => "count",
    }));

    const { checkEmailRateLimit } = await import("../rate-limit");
    const result = await checkEmailRateLimit("runner@example.com", "203.0.113.1");
    expect(result).toEqual({ limited: true, reason: "address" });
  });

  it("refuses on the per-IP count when the address is under its own limit", async () => {
    vi.resetModules();
    let call = 0;
    vi.doMock("@/db", () => ({
      emailLoginTokens: { email: "email", requestedIp: "requestedIp", createdAt: "createdAt" },
      db: {
        select: () => ({
          from: () => ({
            where: () => {
              call++;
              // First call is the address count (under limit), second is the
              // IP count (at limit).
              return Promise.resolve([{ value: call === 1 ? 0 : EMAIL_IP_LIMIT }]);
            },
          }),
        }),
      },
    }));
    vi.doMock("drizzle-orm", () => ({
      and: (...args: unknown[]) => ({ op: "and", args }),
      eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
      gte: (a: unknown, b: unknown) => ({ op: "gte", a, b }),
      isNotNull: (a: unknown) => ({ op: "isNotNull", a }),
      count: () => "count",
    }));

    const { checkEmailRateLimit } = await import("../rate-limit");
    const result = await checkEmailRateLimit("runner@example.com", "203.0.113.1");
    expect(result).toEqual({ limited: true, reason: "ip" });
  });

  it("allows a request under both limits", async () => {
    vi.resetModules();
    vi.doMock("@/db", () => ({
      emailLoginTokens: { email: "email", requestedIp: "requestedIp", createdAt: "createdAt" },
      db: {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([{ value: 0 }]),
          }),
        }),
      },
    }));
    vi.doMock("drizzle-orm", () => ({
      and: (...args: unknown[]) => ({ op: "and", args }),
      eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
      gte: (a: unknown, b: unknown) => ({ op: "gte", a, b }),
      isNotNull: (a: unknown) => ({ op: "isNotNull", a }),
      count: () => "count",
    }));

    const { checkEmailRateLimit } = await import("../rate-limit");
    const result = await checkEmailRateLimit("runner@example.com", "203.0.113.1");
    expect(result).toEqual({ limited: false });
  });
});

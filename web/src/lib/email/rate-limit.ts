// Rate limiting for magic-link requests.
//
// Without this the request route is an email-bombing tool aimed at whoever an
// attacker types into the box: it needs no proof they control the address, so
// nothing stops a script from requesting a link for the same victim every
// second. Two independent windows, both backed by counting rows already in
// email_login_tokens (see 0067) rather than a new store -- this app has no
// Redis, and the volume here (auth requests, not every API call) does not
// need one.
//
// Per-address limit: stops one victim from being flooded regardless of how
// many IPs the attacker sends from. Per-IP limit: stops one attacker from
// enumerating many addresses from the same origin. Both must trip
// independently; either tripping refuses the request.

import { and, count, eq, gte, isNotNull } from "drizzle-orm";
import { db, emailLoginTokens } from "@/db";

export const EMAIL_ADDRESS_LIMIT = 3;
export const EMAIL_ADDRESS_WINDOW_MS = 15 * 60 * 1000;

export const EMAIL_IP_LIMIT = 10;
export const EMAIL_IP_WINDOW_MS = 60 * 60 * 1000;

/** Pure: true if `count` has already reached `limit` for its window. */
export function isRateLimited(requestCount: number, limit: number): boolean {
  return requestCount >= limit;
}

export interface RateLimitCheck {
  limited: boolean;
  reason?: "address" | "ip";
}

/**
 * Counts this address's and this IP's requests in their respective windows
 * and reports whether either has hit its limit. A null IP (no
 * X-Forwarded-For, e.g. local dev) only ever counts against the address
 * limit -- it is never treated as a shared "unknown" bucket other callers
 * could exhaust for everyone.
 */
export async function checkEmailRateLimit(
  email: string,
  ip: string | null
): Promise<RateLimitCheck> {
  const now = new Date();

  const [{ value: addressCount }] = await db
    .select({ value: count() })
    .from(emailLoginTokens)
    .where(
      and(
        eq(emailLoginTokens.email, email),
        gte(emailLoginTokens.createdAt, new Date(now.getTime() - EMAIL_ADDRESS_WINDOW_MS))
      )
    );

  if (isRateLimited(Number(addressCount), EMAIL_ADDRESS_LIMIT)) {
    return { limited: true, reason: "address" };
  }

  if (ip) {
    const [{ value: ipCount }] = await db
      .select({ value: count() })
      .from(emailLoginTokens)
      .where(
        and(
          eq(emailLoginTokens.requestedIp, ip),
          isNotNull(emailLoginTokens.requestedIp),
          gte(emailLoginTokens.createdAt, new Date(now.getTime() - EMAIL_IP_WINDOW_MS))
        )
      );
    if (isRateLimited(Number(ipCount), EMAIL_IP_LIMIT)) {
      return { limited: true, reason: "ip" };
    }
  }

  return { limited: false };
}

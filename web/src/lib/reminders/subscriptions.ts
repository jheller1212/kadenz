// Storage for push subscriptions. A single athlete can have more than one
// device subscribed (phone + desktop), so unlike reminder settings this is a
// real multi-row table, keyed by the endpoint — the same key the sender
// addresses a subscription by, whichever transport it is on.
//
// Two transports live in this table. "web" rows are browser Push API
// subscriptions with a p256dh/auth encryption key pair. "fcm" rows are native
// registration tokens from the shell, which have no key pair. See
// drizzle/0055_push_subscription_transport.sql for why the distinction is
// stored rather than inferred.

import { db, pushSubscriptions } from "@/db";
import type { PushTransport } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";

export interface WebPushSubscriptionRecord {
  transport: "web";
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface NativePushSubscriptionRecord {
  transport: "fcm";
  /** The FCM registration token. */
  endpoint: string;
}

export type PushSubscriptionRecord =
  | WebPushSubscriptionRecord
  | NativePushSubscriptionRecord;

export async function saveSubscription(sub: PushSubscriptionRecord): Promise<void> {
  const keys =
    sub.transport === "web"
      ? { p256dh: sub.p256dh, auth: sub.auth }
      : { p256dh: null, auth: null };

  await db
    .insert(pushSubscriptions)
    .values({ endpoint: sub.endpoint, transport: sub.transport, ...keys })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      // Re-subscribing to the same endpoint can carry new keys (browser
      // resets happen); keep the latest ones rather than rejecting. The
      // transport is written too, so a row can never keep a stale transport
      // while carrying the other transport's key shape.
      set: { transport: sub.transport, ...keys },
    });
}

export async function removeSubscription(endpoint: string): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

export async function listSubscriptions(): Promise<PushSubscriptionRecord[]> {
  const rows = await db
    .select({
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
      transport: pushSubscriptions.transport,
    })
    .from(pushSubscriptions);

  return rows.flatMap((row): PushSubscriptionRecord[] => {
    if (row.transport === "fcm") {
      return [{ transport: "fcm", endpoint: row.endpoint }];
    }
    // A web row with no key pair cannot be encrypted for, so it can never be
    // delivered. The 0055 CHECK constraint makes this unreachable for rows
    // written after that migration; skipping rather than sending keeps a
    // pre-constraint leftover from throwing inside the cron loop.
    if (row.p256dh === null || row.auth === null) return [];
    return [
      { transport: "web", endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth },
    ];
  });
}

/** Drops subscriptions the push service reports as gone (410/404 on send). */
export async function removeExpiredSubscriptions(endpoints: string[]): Promise<void> {
  if (endpoints.length === 0) return;
  await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, endpoints));
}

export type { PushTransport };

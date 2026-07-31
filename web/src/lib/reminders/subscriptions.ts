// Storage for push subscriptions. One athlete can have more than one device
// subscribed (phone + desktop), so unlike reminder settings this is a real
// multi-row table, keyed by the endpoint: the same key the sender addresses a
// subscription by, whichever transport it is on.
//
// A row carries two facts that both have to be right, and they arrived from
// two different pieces of work, so it is worth stating together.
//
// WHOSE device it is. Every read and every user-initiated delete is scoped to
// the owner. listSubscriptions used to return every device of every athlete,
// which is what let the dispatch loop deliver one athlete's reminder to
// everyone.
//
// HOW to reach it. "web" rows are browser Push API subscriptions with a
// p256dh/auth encryption key pair. "fcm" rows are native registration tokens
// from the shell, which have no key pair. See
// drizzle/0055_push_subscription_transport.sql for why the distinction is
// stored rather than inferred from the endpoint's shape.
//
// Get the first wrong and a notification goes to the wrong person. Get the
// second wrong and it goes nowhere. Both fail at delivery time rather than at
// write time, which is why the owner is required at the call site and the
// transport is guarded by a database CHECK constraint.

import { db, pushSubscriptions } from "@/db";
import type { PushTransport } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { UserId } from "@/lib/user-id";

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

export async function saveSubscription(
  userId: UserId,
  sub: PushSubscriptionRecord
): Promise<void> {
  // Derived from the transport rather than taken from the caller, so the key
  // columns and the transport can never disagree. The 0055 CHECK constraint
  // rejects the row if they ever do.
  const keys =
    sub.transport === "web"
      ? { p256dh: sub.p256dh, auth: sub.auth }
      : { p256dh: null, auth: null };

  await db
    .insert(pushSubscriptions)
    .values({ endpoint: sub.endpoint, transport: sub.transport, userId, ...keys })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      // Re-subscribing to the same endpoint can carry new keys (browser resets
      // happen); keep the latest ones rather than rejecting. The transport is
      // written too, so a row can never keep a stale transport while carrying
      // the other transport's key shape.
      //
      // user_id is reassigned as well, and that is the point rather than an
      // oversight. Endpoints are unique across the whole table, so a browser
      // profile or a device that once belonged to one athlete and is now
      // signed in as another would otherwise keep delivering the first
      // athlete's reminders. Whoever most recently subscribed owns it.
      set: { transport: sub.transport, userId, ...keys },
    });
}

export async function removeSubscription(userId: UserId, endpoint: string): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

/** This athlete's own devices. Anything wider is a push sent to a stranger. */
export async function listSubscriptions(userId: UserId): Promise<PushSubscriptionRecord[]> {
  const rows = await db
    .select({
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
      transport: pushSubscriptions.transport,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));

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

/**
 * Drops subscriptions the push service reports as gone (410/404 on send).
 *
 * Not scoped to a user, unlike removeSubscription. The caller is the dispatch
 * loop, which only ever collects endpoints it just tried to send to, and the
 * push service has said those endpoints no longer exist for anyone.
 */
export async function removeExpiredSubscriptions(endpoints: string[]): Promise<void> {
  if (endpoints.length === 0) return;
  await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, endpoints));
}

export type { PushTransport };

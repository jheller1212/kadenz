// Storage for browser push subscriptions. One athlete can have more than one
// device subscribed (phone + desktop), so this is a real multi-row table,
// keyed by the subscription endpoint (the same key the Push API and web-push
// itself address a subscription by) and owned by a user.
//
// Every read and every user-initiated delete is scoped to that owner.
// listSubscriptions used to return every device of every athlete, which is
// what let the dispatch loop deliver one athlete's reminder to everyone.

import { db, pushSubscriptions } from "@/db";
import { and, eq, inArray } from "drizzle-orm";
import type { UserId } from "@/lib/user-id";

export interface PushSubscriptionRecord {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function saveSubscription(
  userId: UserId,
  sub: PushSubscriptionRecord
): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values({ ...sub, userId })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      // Re-subscribing to the same endpoint can carry new keys (browser
      // resets happen); keep the latest ones rather than rejecting.
      //
      // user_id is reassigned too, and that is the point rather than an
      // oversight. Endpoints are unique across the whole table, so a browser
      // profile that once belonged to one athlete and is now signed in as
      // another would otherwise keep delivering the first athlete's
      // reminders. Whoever most recently subscribed owns the endpoint.
      set: { p256dh: sub.p256dh, auth: sub.auth, userId },
    });
}

export async function removeSubscription(userId: UserId, endpoint: string): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

export async function listSubscriptions(userId: UserId): Promise<PushSubscriptionRecord[]> {
  return db
    .select({
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
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

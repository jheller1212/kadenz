// Storage for browser push subscriptions. A single athlete can have more
// than one device subscribed (phone + desktop), so unlike reminder settings
// this is a real multi-row table, keyed by the subscription endpoint (the
// same key the Push API and web-push itself address a subscription by).

import { db, pushSubscriptions } from "@/db";
import { eq, inArray } from "drizzle-orm";

export interface PushSubscriptionRecord {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function saveSubscription(sub: PushSubscriptionRecord): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values(sub)
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      // Re-subscribing to the same endpoint can carry new keys (browser
      // resets happen); keep the latest ones rather than rejecting.
      set: { p256dh: sub.p256dh, auth: sub.auth },
    });
}

export async function removeSubscription(endpoint: string): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

export async function listSubscriptions(): Promise<PushSubscriptionRecord[]> {
  return db
    .select({
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions);
}

/** Drops subscriptions the push service reports as gone (410/404 on send). */
export async function removeExpiredSubscriptions(endpoints: string[]): Promise<void> {
  if (endpoints.length === 0) return;
  await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, endpoints));
}

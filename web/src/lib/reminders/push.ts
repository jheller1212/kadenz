// Send path for web push. VAPID keys are generated locally (not issued by a
// third party) and read from env — never hardcoded. A send attempted without
// them fails loudly rather than being silently swallowed, per the "public
// prefix means public, real secrets fail fast" convention.

import webpush from "web-push";

let configured = false;

function ensureConfigured(): void {
  if (configured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const contact = process.env.VAPID_CONTACT_EMAIL;
  if (!publicKey || !privateKey || !contact) {
    throw new Error(
      "Push notifications are not configured: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, " +
        "and VAPID_CONTACT_EMAIL must all be set. Refusing to silently no-op."
    );
  }
  webpush.setVapidDetails(`mailto:${contact}`, publicKey, privateKey);
  configured = true;
}

export interface ReminderPushPayload {
  title: string;
  body: string;
  /** In-app path to open on tap, e.g. "/". */
  url: string;
}

export interface PushSendResult {
  ok: boolean;
  /** True on 404/410 — the push service says this subscription is dead. */
  expired: boolean;
  error?: string;
}

export async function sendPush(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: ReminderPushPayload
): Promise<PushSendResult> {
  ensureConfigured();
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return { ok: true, expired: false };
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    const expired = statusCode === 404 || statusCode === 410;
    return { ok: false, expired, error: err instanceof Error ? err.message : String(err) };
  }
}

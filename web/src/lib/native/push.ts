// Native half of push subscription, mirroring lib/reminders/subscribe-client.ts.
//
// Why this exists: on iOS, web push only works when the site has been added to
// the home screen. In a normal Safari tab it silently does nothing, which is
// the single worst failure mode a reminder feature can have. Inside the native
// shell the OS grants notification permission to the app itself, so there is
// no such condition.
//
// The token is an FCM registration token on both platforms. Firebase forwards
// to APNs on iOS, so the server has one send path (lib/reminders/fcm.ts).

import { apiFetch } from "@/lib/api";
import {
  firebaseMessagingPlugin,
  isNativeShell,
  pushNotificationsPlugin,
} from "./bridge";

/**
 * Asks for notification permission, registers with APNs or FCM, and stores the
 * resulting token on the server. Safe to call on every app start: registering
 * an already-registered device returns the same token, and the server upserts
 * on it.
 *
 * Returns false in a browser, so callers can fall back to web push.
 */
export async function registerNativePush(): Promise<boolean> {
  if (!isNativeShell()) return false;

  const push = pushNotificationsPlugin();
  const messaging = firebaseMessagingPlugin();
  if (!push || !messaging) {
    console.error("Native push plugins are not installed in this shell build.");
    return false;
  }

  try {
    let status = await push.checkPermissions();
    if (status.receive === "prompt" || status.receive === "prompt-with-rationale") {
      status = await push.requestPermissions();
    }
    if (status.receive !== "granted") return false;

    // register() is what actually connects to APNs/FCM. getToken() before it
    // has completed returns nothing on iOS, so the order matters.
    await push.register();
    const { token } = await messaging.getToken();
    if (!token) return false;

    const res = await apiFetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transport: "fcm", token }),
    });
    return res.ok;
  } catch (err) {
    console.error("Native push registration failed:", err);
    return false;
  }
}

/** Drops this device's native token locally and on the server. */
export async function unregisterNativePush(): Promise<void> {
  if (!isNativeShell()) return;
  const messaging = firebaseMessagingPlugin();
  if (!messaging) return;

  try {
    // Read the token before deleting it: after deleteToken there is nothing
    // left to tell the server to remove, and the row would linger and collect
    // failed sends until FCM reported it unregistered.
    const { token } = await messaging.getToken();
    await messaging.deleteToken();
    if (!token) return;
    await apiFetch("/api/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: token }),
    });
  } catch (err) {
    console.error("Native push unregistration failed:", err);
  }
}

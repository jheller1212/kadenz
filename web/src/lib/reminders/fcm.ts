// Send path for native push, via Firebase Cloud Messaging HTTP v1.
//
// Why FCM for iOS too, rather than talking to APNs directly: Firebase already
// forwards to APNs, so one send path covers both platforms and the APNs
// signing key lives in the Firebase console instead of in this repo's env.
// One credential to rotate, one protocol to get wrong.
//
// Why raw fetch and node:crypto rather than firebase-admin or google-auth-
// library: the only thing needed here is one RS256-signed JWT and two POSTs.
// firebase-admin pulls in a large dependency tree for that, and this file runs
// in a cron route where cold start time is the whole budget. It also adds no
// new package to the lockfile.

import { createSign } from "node:crypto";
import type { ReminderPushPayload, PushSendResult } from "./push";

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

function loadServiceAccount(): ServiceAccount {
  const projectId = process.env.FCM_PROJECT_ID;
  const clientEmail = process.env.FCM_CLIENT_EMAIL;
  const privateKey = process.env.FCM_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Native push is not configured: FCM_PROJECT_ID, FCM_CLIENT_EMAIL and " +
        "FCM_PRIVATE_KEY must all be set. Refusing to silently no-op."
    );
  }
  return {
    projectId,
    clientEmail,
    // Vercel env vars cannot hold real newlines, so the PEM is stored with
    // literal \n and restored here. Without this the key fails to import with
    // an error that says nothing about the cause.
    privateKey: privateKey.replace(/\\n/g, "\n"),
  };
}

// Google's access tokens last an hour. Caching one across invocations of a
// warm lambda saves a round trip per reminder run; the 60s margin means a
// token is never used in the seconds before it expires.
const TOKEN_EXPIRY_MARGIN_MS = 60_000;
let cachedToken: { value: string; expiresAtMs: number } | null = null;

function base64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Builds the RS256 service-account assertion Google exchanges for a token. */
export function signServiceAccountJwt(
  account: Pick<ServiceAccount, "clientEmail" | "privateKey">,
  issuedAtSeconds: number
): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: account.clientEmail,
      sub: account.clientEmail,
      aud: TOKEN_URL,
      scope: FCM_SCOPE,
      iat: issuedAtSeconds,
      exp: issuedAtSeconds + 3600,
    })
  );
  const signingInput = `${header}.${claims}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .sign(account.privateKey);
  return `${signingInput}.${base64url(signature)}`;
}

async function getAccessToken(account: ServiceAccount): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAtMs - TOKEN_EXPIRY_MARGIN_MS > now) {
    return cachedToken.value;
  }

  const assertion = signServiceAccountJwt(account, Math.floor(now / 1000));

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`FCM token exchange failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: json.access_token,
    expiresAtMs: now + json.expires_in * 1000,
  };
  return json.access_token;
}

/**
 * True only when FCM says this specific token will never work again, so the
 * row should be deleted rather than retried. That means UNREGISTERED, which is
 * FCM's way of saying the app was uninstalled or the token was replaced.
 *
 * Deliberately narrow. INVALID_ARGUMENT is NOT treated as permanent, even
 * though a malformed token is one of the things that produces it, because a
 * malformed *message* produces exactly the same code. A bug in the payload we
 * send would return INVALID_ARGUMENT for every device at once, and treating
 * that as permanent would delete every native subscription in the table on a
 * single cron run. Recovering from that needs every athlete to reinstall or
 * re-enable notifications, which is unrecoverable in practice.
 *
 * The cost of being wrong the other way is far smaller: a genuinely malformed
 * token keeps its row and fails a few more times until the retry cap in
 * retry.ts stops attempting it. Wasted work, no data loss.
 */
export function isPermanentFcmFailure(status: number, body: string): boolean {
  // 404 NOT_FOUND is the documented "this registration token is gone".
  if (status === 404) return true;
  if (status === 400 || status === 403) {
    return body.includes("UNREGISTERED");
  }
  return false;
}

export async function sendFcmPush(
  token: string,
  payload: ReminderPushPayload
): Promise<PushSendResult> {
  let account: ServiceAccount;
  let accessToken: string;
  try {
    account = loadServiceAccount();
    accessToken = await getAccessToken(account);
  } catch (err) {
    // A configuration problem is not the token's fault, so never report it as
    // expired: that would delete every native subscription in the table.
    return { ok: false, expired: false, error: err instanceof Error ? err.message : String(err) };
  }

  try {
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${account.projectId}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: payload.title, body: payload.body },
            // The shell reads this to route the tap. Sent as data alongside
            // the notification so the payload matches the web push shape and
            // the two clients can share one handler contract.
            data: { url: payload.url },
            apns: {
              payload: { aps: { sound: "default" } },
            },
            android: {
              notification: { sound: "default" },
            },
          },
        }),
      }
    );

    if (res.ok) return { ok: true, expired: false };

    const body = await res.text();
    return {
      ok: false,
      expired: isPermanentFcmFailure(res.status, body),
      error: `FCM send failed: ${res.status} ${body}`,
    };
  } catch (err) {
    return { ok: false, expired: false, error: err instanceof Error ? err.message : String(err) };
  }
}

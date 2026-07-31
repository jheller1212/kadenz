import { NextRequest } from "next/server";
import { withSession } from "@/lib/api/with-session";
import {
  getWebhookSubscription,
  registerWebhookSubscription,
  loadSubscription,
} from "@/lib/sync/strava-client";

// ── GET /api/strava/subscription ──────────────────────────────────────────────
// Shows the app's webhook subscription on Strava plus what we have stored.
// Session-gated by the proxy like every other /api route, and now also
// wrapped in withSession: `stored` reads the tenanted sync_outbox singleton
// (Phase 3), so it needs a row level security context to see the caller's own
// copy of it.

export const GET = withSession(async () => {
  try {
    const [remote, stored] = await Promise.all([
      getWebhookSubscription(),
      loadSubscription(),
    ]);
    return Response.json({ remote, stored });
  } catch (err) {
    console.error("Strava subscription lookup failed:", err);
    return Response.json({ error: "Failed to look up subscription" }, { status: 502 });
  }
});

// ── POST /api/strava/subscription ─────────────────────────────────────────────
// Registers (or repairs) the webhook subscription so new activities sync
// automatically. Body may override the callback URL; defaults to
// NEXT_PUBLIC_BASE_URL + /api/strava/webhook.
//
// Strava issues one subscription for the whole app. saveSubscription writes
// it under whichever user calls this, and the webhook (see its route) checks
// the event's subscription_id against THAT SAME user's stored copy after
// mapping the event's athlete id to a Kadenz user — so whoever's Strava
// account the webhook events are actually for is also the user who needs to
// have called this at least once. In today's single/near-single-user beta
// that's the owner; a future multi-athlete Strava setup would need each
// connected athlete to register their own copy (or a real singleton
// credentials table — Phase 4, see strava-client.ts's token comment).

export const POST = withSession(async (request: NextRequest) => {
  let callbackUrl: string | undefined;
  try {
    const text = await request.text();
    if (text) callbackUrl = (JSON.parse(text) as { callbackUrl?: string }).callbackUrl;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!callbackUrl) {
    const base = process.env.NEXT_PUBLIC_BASE_URL;
    if (!base) {
      return Response.json({ error: "NEXT_PUBLIC_BASE_URL is not set" }, { status: 500 });
    }
    callbackUrl = `${base.replace(/\/$/, "")}/api/strava/webhook`;
  }

  try {
    const stored = await registerWebhookSubscription(callbackUrl);
    return Response.json(stored);
  } catch (err) {
    console.error("Strava subscription registration failed:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Registration failed" },
      { status: 502 }
    );
  }
});

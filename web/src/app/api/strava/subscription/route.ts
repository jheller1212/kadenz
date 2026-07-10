import { NextRequest } from "next/server";
import {
  getWebhookSubscription,
  registerWebhookSubscription,
  loadSubscription,
} from "@/lib/sync/strava-client";

// ── GET /api/strava/subscription ──────────────────────────────────────────────
// Shows the app's webhook subscription on Strava plus what we have stored.
// Session-gated by the proxy like every other /api route.

export async function GET() {
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
}

// ── POST /api/strava/subscription ─────────────────────────────────────────────
// Registers (or repairs) the webhook subscription so new activities sync
// automatically. Body may override the callback URL; defaults to
// NEXT_PUBLIC_BASE_URL + /api/strava/webhook.

export async function POST(request: NextRequest) {
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
}

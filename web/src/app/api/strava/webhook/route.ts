import { type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { processActivity } from "@/lib/sync/strava-client";

// ── Signature verification ──────────────────────────────────────────────────

function verifySignature(body: string, signature: string | null): boolean {
  const secret = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
  if (!secret || !signature) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    // Buffers of different lengths throw — means signature mismatch
    return false;
  }
}

// ── GET: Webhook subscription verification ──────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && token === verifyToken && challenge) {
    return Response.json({ "hub.challenge": challenge });
  }

  return Response.json({ error: "Verification failed" }, { status: 403 });
}

// ── POST: Incoming webhook events ───────────────────────────────────────────

interface StravaWebhookEvent {
  object_type: "activity" | "athlete";
  object_id: number;
  aspect_type: "create" | "update" | "delete";
  owner_id: number;
  subscription_id: number;
  event_time: number;
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-2");

  if (!verifySignature(rawBody, signature)) {
    return Response.json({ error: "Invalid signature" }, { status: 403 });
  }

  let event: StravaWebhookEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Only process new activities
  if (event.object_type === "activity" && event.aspect_type === "create") {
    // Process async — respond to Strava quickly (must reply within 2s)
    processActivity(event.object_id).catch((err) => {
      console.error(
        `Failed to process Strava activity ${event.object_id}:`,
        err
      );
    });
  }

  // Strava expects 200 for all events
  return Response.json({ ok: true });
}

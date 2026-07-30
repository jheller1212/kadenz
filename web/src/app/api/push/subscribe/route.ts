import { NextRequest } from "next/server";
import { z } from "zod";
import { saveSubscription } from "@/lib/reminders/subscriptions";
import { getSessionUserId } from "@/lib/session";

// ── POST /api/push/subscribe ─────────────────────────────────────────────────
// Stores a browser push subscription server-side so the reminder cron can
// address it. The client is the enforcement point for "only after the athlete
// allowed notifications" (see lib/permissions.ts) — this route just persists
// whatever subscription object the Push API handed back.
//
// proxy.ts already requires a valid session here. The user id is what decides
// whose device this is, and therefore whose workouts it will be told about.

const SubscriptionSchema = z
  .object({
    endpoint: z.string().url(),
    keys: z.object({
      p256dh: z.string().min(1),
      auth: z.string().min(1),
    }),
  })
  .strict();

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId(request.headers.get("cookie"));
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = SubscriptionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 422 });
  }

  try {
    await saveSubscription(userId, {
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
    });
    return Response.json({ ok: true });
  } catch (err) {
    console.error("Push subscribe error:", err);
    return Response.json({ error: "Failed to save subscription" }, { status: 500 });
  }
}

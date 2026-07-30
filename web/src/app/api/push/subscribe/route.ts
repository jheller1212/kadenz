import { NextRequest } from "next/server";
import { z } from "zod";
import { saveSubscription } from "@/lib/reminders/subscriptions";
import { requireRequestUser } from "@/lib/request-user";

// ── POST /api/push/subscribe ─────────────────────────────────────────────────
// Stores a browser push subscription server-side so the reminder cron can
// address it. The client is the enforcement point for "only after the athlete
// allowed notifications" (see lib/permissions.ts) — this route just persists
// whatever subscription object the Push API handed back.
//
// Resolved through request-user.ts (not getSessionUserId directly) so the
// native shell's bearer token reaches the same tenancy as the browser cookie
// path. The user id is what decides whose device this is, and therefore
// whose workouts it will be told about. This route is the one that proves
// that whole auth chain end to end.

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
  const auth = await requireRequestUser(request);
  if (auth.response) return auth.response;

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
    await saveSubscription(auth.userId, {
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

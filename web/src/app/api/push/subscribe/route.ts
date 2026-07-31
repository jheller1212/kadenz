import { z } from "zod";
import { saveSubscription } from "@/lib/reminders/subscriptions";
import { withSession } from "@/lib/api/with-session";
import { currentUserId } from "@/db/with-user";

// ── POST /api/push/subscribe ─────────────────────────────────────────────────
// Stores a push subscription server-side so the reminder cron can address it.
// The client is the enforcement point for "only after the athlete allowed
// notifications" (see lib/permissions.ts) — this route just persists whatever
// the platform handed back.
//
// Two shapes are accepted. A browser sends the Push API subscription object.
// The native shell sends an FCM registration token, which is an opaque string
// and not a URL, so the two are separate schemas rather than one loose schema
// with optional keys: a native token arriving without its transport set would
// otherwise be stored as an undeliverable web row.
//
// proxy.ts already requires a valid session here. Which USER is asking is what
// decides whose device this is, and therefore whose workouts it will be told
// about, so the subscription is written inside the caller's context rather than
// taking a user id as an argument that could be the wrong one.

const WebSubscriptionSchema = z
  .object({
    transport: z.literal("web").optional(),
    endpoint: z.string().url(),
    keys: z.object({
      p256dh: z.string().min(1),
      auth: z.string().min(1),
    }),
  })
  .strict();

const NativeSubscriptionSchema = z
  .object({
    transport: z.literal("fcm"),
    token: z.string().min(1),
  })
  .strict();

const SubscriptionSchema = z.union([WebSubscriptionSchema, NativeSubscriptionSchema]);

export const POST = withSession(async (request) => {
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
    await saveSubscription(
      currentUserId(),
      parsed.data.transport === "fcm"
        ? { transport: "fcm", endpoint: parsed.data.token }
        : {
            transport: "web",
            endpoint: parsed.data.endpoint,
            p256dh: parsed.data.keys.p256dh,
            auth: parsed.data.keys.auth,
          }
    );
    return Response.json({ ok: true });
  } catch (err) {
    console.error("Push subscribe error:", err);
    return Response.json({ error: "Failed to save subscription" }, { status: 500 });
  }
});

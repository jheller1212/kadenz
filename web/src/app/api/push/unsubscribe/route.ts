import { z } from "zod";
import { removeSubscription } from "@/lib/reminders/subscriptions";
import { withSession } from "@/lib/api/with-session";
import { currentUserId } from "@/db/with-user";

// ── POST /api/push/unsubscribe ───────────────────────────────────────────────
// Called when the athlete turns reminders off on this device, or when the
// notification permission gets revoked at the OS level.

const BodySchema = z.object({ endpoint: z.string().url() }).strict();

export const POST = withSession(async (request) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 422 });
  }

  try {
    await removeSubscription(currentUserId(), parsed.data.endpoint);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("Push unsubscribe error:", err);
    return Response.json({ error: "Failed to remove subscription" }, { status: 500 });
  }
});

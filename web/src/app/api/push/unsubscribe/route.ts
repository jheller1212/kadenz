import { NextRequest } from "next/server";
import { z } from "zod";
import { removeSubscription } from "@/lib/reminders/subscriptions";

// ── POST /api/push/unsubscribe ───────────────────────────────────────────────
// Called when the athlete turns reminders off on this device, or when the
// notification permission gets revoked at the OS level.

const BodySchema = z.object({ endpoint: z.string().url() }).strict();

export async function POST(request: NextRequest) {
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
    await removeSubscription(parsed.data.endpoint);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("Push unsubscribe error:", err);
    return Response.json({ error: "Failed to remove subscription" }, { status: 500 });
  }
}

import { NextRequest } from "next/server";
import { z } from "zod";
import { loadReminderConfig, saveReminderConfig } from "@/lib/reminders/settings";
import { requireRequestUser } from "@/lib/request-user";

// ── /api/reminders/settings ──────────────────────────────────────────────────
// Server-side home of the reminder toggle + lead time, same pattern as
// /api/garmin/config: it must live in the DB so the cron can read it.
//
// proxy.ts already requires a valid credential to reach this route, so the
// point of reading the user id here is not authentication but scoping:
// without it both handlers work on whichever settings row came back first, so
// one athlete could read and overwrite another's reminder toggle.
//
// Resolved through request-user.ts rather than getSessionUserId directly, so
// the native shell's bearer token reaches the same tenancy as the cookie.

const TIME_RE = /^\d{2}:\d{2}$/;

const ConfigSchema = z
  .object({
    enabled: z.boolean(),
    leadMinutes: z.number().int().min(5).max(240),
    defaultTimeOfDay: z.string().regex(TIME_RE),
  })
  .strict();

export async function GET(request: NextRequest) {
  const auth = await requireRequestUser(request);
  if (auth.response) return auth.response;

  try {
    return Response.json(await loadReminderConfig(auth.userId));
  } catch (err) {
    console.error("Reminder settings read error:", err);
    return Response.json({ error: "Failed to read reminder settings" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRequestUser(request);
  if (auth.response) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = ConfigSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 422 });
  }

  try {
    await saveReminderConfig(auth.userId, parsed.data);
    return Response.json(parsed.data);
  } catch (err) {
    console.error("Reminder settings write error:", err);
    return Response.json({ error: "Failed to save reminder settings" }, { status: 500 });
  }
}

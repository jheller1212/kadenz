import { z } from "zod";
import { loadReminderConfig, saveReminderConfig } from "@/lib/reminders/settings";
import { withSession } from "@/lib/api/with-session";
import { currentUserId } from "@/db/with-user";

// ── /api/reminders/settings ──────────────────────────────────────────────────
// Server-side home of the reminder toggle + lead time, same pattern as
// /api/garmin/config: it must live in the DB so the cron can read it.
//
// proxy.ts already requires a valid session to reach this route, so the point
// of the user id here is not authentication but scoping: without it both
// handlers work on whichever settings row came back first, so one athlete could
// read and overwrite another's reminder toggle.
//
// withSession is what supplies it. It opens the request's row level security
// context, so currentUserId() cannot disagree with the rows the database is
// willing to return.

const TIME_RE = /^\d{2}:\d{2}$/;

const ConfigSchema = z
  .object({
    enabled: z.boolean(),
    leadMinutes: z.number().int().min(5).max(240),
    defaultTimeOfDay: z.string().regex(TIME_RE),
  })
  .strict();

export const GET = withSession(async () => {
  try {
    return Response.json(await loadReminderConfig(currentUserId()));
  } catch (err) {
    console.error("Reminder settings read error:", err);
    return Response.json({ error: "Failed to read reminder settings" }, { status: 500 });
  }
});

export const POST = withSession(async (request) => {
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
    await saveReminderConfig(currentUserId(), parsed.data);
    return Response.json(parsed.data);
  } catch (err) {
    console.error("Reminder settings write error:", err);
    return Response.json({ error: "Failed to save reminder settings" }, { status: 500 });
  }
});

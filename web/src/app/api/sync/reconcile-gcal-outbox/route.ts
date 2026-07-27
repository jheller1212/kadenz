import { type NextRequest } from "next/server";
import { validateSessionCookie } from "@/lib/session";
import { previewGcalOutboxCleanup, applyGcalOutboxCleanup } from "@/lib/sync/gcal-outbox-cleanup";

// ── GET /api/sync/reconcile-gcal-outbox ─────────────────────────────────────
// Google Calendar sync has been broken for a long time (expired grant, and
// unset OAuth env vars before that), so the pending gcal outbox has been
// growing instead of draining. A pending job is dead on arrival once either
// of its two dependencies is gone: the workout/strength_session row itself,
// or the plan it belongs to (archived). Reconnecting the grant would drain
// the whole queue at once and dump every one of those stale jobs onto the
// calendar — this sweeps them first.
//
// Bare call or ?apply=0 (the default) changes nothing and just reports what
// would be cancelled; ?apply=1 is required to actually cancel jobs. Cancelled
// jobs move to sync_status "cancelled" rather than being deleted, so the
// outbox keeps an auditable record of what got swept and why.
//
// Never touches a job for the active plan — the archived-status filter and
// the entity-exists check are the whole guard, both enforced by the same
// pure predicate this route shares with its unit tests.
//
// Auth mirrors the other reconcile routes: CRON_SECRET bearer or an owner
// session cookie.

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const fromCron =
    Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
  const fromOwner = await validateSessionCookie(request.headers.get("cookie"));
  if (!fromCron && !fromOwner) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apply = request.nextUrl.searchParams.get("apply") === "1";

  try {
    if (!apply) {
      const preview = await previewGcalOutboxCleanup();
      return Response.json({ apply: false, ...preview });
    }
    const result = await applyGcalOutboxCleanup();
    return Response.json({ apply: true, ...result });
  } catch (err) {
    console.error("Failed to reconcile gcal outbox:", err);
    return Response.json({ error: "Reconcile failed" }, { status: 500 });
  }
}

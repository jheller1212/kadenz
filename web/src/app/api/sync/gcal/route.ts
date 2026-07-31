import { processGCalOutbox } from "@/lib/sync/sync-manager";
import { isConnected } from "@/lib/sync/gcal-client";
import { withSession } from "@/lib/api/with-session";
import { currentUserId } from "@/db/with-user";

// POST /api/sync/gcal, process pending gcal sync jobs
//
// The 503 gate is about the CALLER: someone who has not connected a calendar
// has nothing of their own to drain and should be told so. isConnected reads
// integration_credentials (tenanted, FORCE row level security), so the gate
// itself needs withSession's transaction — without it the read matched zero
// rows for everyone and this always answered 503, "not connected", even for
// a connected caller.
//
// processGCalOutbox is scoped to the caller: it claims and drains only this
// person's own pending rows (one transaction can only carry one app.user_id
// — see that function's comment in sync-manager.ts), which is also the
// semantically correct answer for a "force sync" button someone presses on
// their own account.
export const POST = withSession(async () => {
  if (!(await isConnected(currentUserId()))) {
    return Response.json(
      { error: "Google Calendar not connected" },
      { status: 503 }
    );
  }

  try {
    const result = await processGCalOutbox(currentUserId());
    return Response.json(result);
  } catch (err) {
    console.error("GCal sync error:", err);
    return Response.json({ error: "Sync failed" }, { status: 500 });
  }
});

// GET /api/sync/gcal, check connection status + pending count
export const GET = withSession(async () => {
  // The caller's own connection, not the installation's. Reporting anyone
  // else's would tell someone with no calendar that they have one.
  const connected = await isConnected(currentUserId());
  return Response.json({ connected });
});

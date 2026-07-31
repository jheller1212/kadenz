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
// processGCalOutbox itself is deliberately NOT scoped to the caller: each
// outbox row records its own owner and is delivered with that owner's
// credentials, so one drain correctly serves everybody. That is real,
// pre-existing tension with row level security (it reads/writes sync_outbox
// across every user from inside a single-user transaction context) rather
// than an instance of this route's bug — see the PR description for why it
// is out of scope here.
export const POST = withSession(async () => {
  if (!(await isConnected(currentUserId()))) {
    return Response.json(
      { error: "Google Calendar not connected" },
      { status: 503 }
    );
  }

  try {
    const result = await processGCalOutbox();
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

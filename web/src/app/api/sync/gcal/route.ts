import { processGCalOutbox } from "@/lib/sync/sync-manager";
import { isConnected } from "@/lib/sync/gcal-client";
import { resolveRequestUserId } from "@/lib/request-user";

// POST /api/sync/gcal, process pending gcal sync jobs
//
// The 503 gate is about the CALLER: someone who has not connected a calendar
// has nothing of their own to drain and should be told so. The drain it then
// performs is deliberately not scoped to them, because each outbox row records
// its own owner and is delivered with that owner's credentials.
export async function POST(request: Request) {
  const userId = await resolveRequestUserId(request);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  if (!(await isConnected(userId))) {
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
}

// GET /api/sync/gcal, check connection status + pending count
export async function GET(request: Request) {
  const userId = await resolveRequestUserId(request);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // The caller's own connection, not the installation's. Reporting anyone
  // else's would tell someone with no calendar that they have one.
  const connected = await isConnected(userId);
  return Response.json({ connected });
}

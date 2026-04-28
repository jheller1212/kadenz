import { processGCalOutbox } from "@/lib/sync/sync-manager";
import { isConnected } from "@/lib/sync/gcal-client";

// POST /api/sync/gcal — process pending gcal sync jobs
export async function POST() {
  if (!(await isConnected())) {
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

// GET /api/sync/gcal — check connection status + pending count
export async function GET() {
  const connected = await isConnected();
  return Response.json({ connected });
}

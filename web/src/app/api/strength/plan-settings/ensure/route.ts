import { NextRequest } from "next/server";
import { getActiveProfileId } from "@/lib/profiles";
import { ensureStrengthSchedule } from "@/lib/strength/schedule";

// Idempotent top-up of the next two weeks of auto-scheduled strength sessions.
// Fired opportunistically from the Kraft screen; cheap no-op when up to date.
export async function POST(request: NextRequest) {
  try {
    const result = await ensureStrengthSchedule(getActiveProfileId(request));
    return Response.json(result);
  } catch (err) {
    console.error("[plan-settings] ensure failed", err);
    return Response.json({ error: "Failed to top up schedule" }, { status: 500 });
  }
}

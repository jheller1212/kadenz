import { NextRequest } from "next/server";
import { getVerifiedProfileId } from "@/lib/profiles";
import { ensureStrengthSchedule } from "@/lib/strength/schedule";
import { withSession } from "@/lib/api/with-session";
import { currentUserId } from "@/db/with-user";

// Idempotent top-up of the next two weeks of auto-scheduled strength sessions.
// Fired opportunistically from the Kraft screen; cheap no-op when up to date.
export const POST = withSession(async (request: NextRequest) => {
  try {
    const result = await ensureStrengthSchedule(await getVerifiedProfileId(request), currentUserId());
    return Response.json(result);
  } catch (err) {
    console.error("[plan-settings] ensure failed", err);
    return Response.json({ error: "Failed to top up schedule" }, { status: 500 });
  }
});

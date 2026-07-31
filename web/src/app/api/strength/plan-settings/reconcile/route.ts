import { NextRequest } from "next/server";
import { getVerifiedProfileId } from "@/lib/profiles";
import { reconcileStrengthSchedule } from "@/lib/strength/schedule";
import { withSession } from "@/lib/api/with-session";
import { currentUserId } from "@/db/with-user";

// One-shot cleanup: prune future auto-scheduled sessions the user never
// touched, then re-run the top-up against the active plan's run days. Same
// operation plan create/regenerate performs; callable standalone when the
// schedule has drifted (e.g. sessions stacked by an earlier plan).
export const POST = withSession(async (request: NextRequest) => {
  try {
    const result = await reconcileStrengthSchedule(await getVerifiedProfileId(request), currentUserId());
    return Response.json(result);
  } catch (err) {
    console.error("[plan-settings] reconcile failed", err);
    return Response.json({ error: "Failed to reconcile schedule" }, { status: 500 });
  }
});

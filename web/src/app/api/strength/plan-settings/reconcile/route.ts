import { NextRequest } from "next/server";
import { getActiveProfileId } from "@/lib/profiles";
import { reconcileStrengthSchedule } from "@/lib/strength/schedule";

// One-shot cleanup: prune future auto-scheduled sessions the user never
// touched, then re-run the top-up against the active plan's run days. Same
// operation plan create/regenerate performs; callable standalone when the
// schedule has drifted (e.g. sessions stacked by an earlier plan).
export async function POST(request: NextRequest) {
  try {
    const result = await reconcileStrengthSchedule(getActiveProfileId(request));
    return Response.json(result);
  } catch (err) {
    console.error("[plan-settings] reconcile failed", err);
    return Response.json({ error: "Failed to reconcile schedule" }, { status: 500 });
  }
}

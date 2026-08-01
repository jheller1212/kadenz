import type { NextRequest } from "next/server";
import { withSession } from "@/lib/api/with-session";
import { getVerifiedProfileId } from "@/lib/profiles";
import { getActivePlanBundle } from "../service";

// ── GET /api/plans/active ───────────────────────────────────────────────────
// One round trip for "what is my active plan" instead of the /api/today ->
// /api/plans/[id] chain the four /plan/* screens used to run purely to learn
// a plan id /api/today already knew server-side. No id in the request or the
// response shape that isn't the caller's own (see getActivePlanBundle) — the
// active plan is resolved from the session, same as /api/today.
//
// `?sessions=1` additionally folds in this plan's strength sessions (the
// window from the plan's first workout through race week), which used to be
// a third, separately-dependent call once the plan response revealed its own
// date range. `?summary=1` forwards to getPlanById's summary mode, dropping
// block detail for screens that never render it.
export const GET = withSession(async (request: NextRequest) => {
  const profileId = await getVerifiedProfileId(request);
  const includeSessions = request.nextUrl.searchParams.get("sessions") === "1";
  const summary = request.nextUrl.searchParams.get("summary") === "1";

  try {
    const bundle = await getActivePlanBundle({ profileId, includeSessions, summary });
    return Response.json(bundle);
  } catch (err) {
    console.error("DB error fetching active plan:", err);
    return Response.json({ error: "Failed to fetch active plan" }, { status: 500 });
  }
});

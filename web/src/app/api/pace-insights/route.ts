import { withSession } from "@/lib/api/with-session";
import { getPaceInsights } from "./service";

// ── GET /api/pace-insights ────────────────────────────────────────────────────
// Returns pace zone data, speed/long workout history, next speed workout, and PRs.
// The query lives in service.ts so /api/today/bootstrap runs the same thing.

export const GET = withSession(async () => {
  try {
    return Response.json(await getPaceInsights());
  } catch (err) {
    console.error("DB error fetching pace insights:", err);
    return Response.json({ error: "Failed to fetch pace insights" }, { status: 500 });
  }
});

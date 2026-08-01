import { withSession } from "@/lib/api/with-session";
import { getTodaySnapshot } from "./service";

// ── GET /api/today ────────────────────────────────────────────────────────────
// Returns the active plan's current week workouts + stats + week info.
// The query itself lives in service.ts so /api/today/bootstrap can run the
// exact same thing inside its one transaction instead of a second copy.

export const GET = withSession(async () => {
  try {
    return Response.json(await getTodaySnapshot());
  } catch (err) {
    console.error("DB error fetching today:", err);
    return Response.json({ error: "Failed to fetch today data" }, { status: 500 });
  }
});

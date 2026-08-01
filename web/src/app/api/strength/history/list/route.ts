import { NextRequest } from "next/server";
import { getVerifiedProfileId } from "@/lib/profiles";
import { withSession } from "@/lib/api/with-session";
import { listExerciseHistories } from "../service";

// ── GET /api/strength/history/list ────────────────────────────────────────────
// Every exercise's sparkline history in one response, for the
// /strength/history list screen. This used to be /api/strength/exercises
// (the ~100-exercise catalogue) followed by one
// /api/strength/history/[exerciseId] call per exercise — up to ~100 parallel
// serverless invocations, each paying its own cold start, before the screen
// could render anything. See listExerciseHistories in ../service.ts for the
// single-pass query this replaces it with.

export const GET = withSession(async (request: NextRequest) => {
  const profileId = await getVerifiedProfileId(request);
  try {
    const items = await listExerciseHistories(profileId);
    return Response.json(items);
  } catch (err) {
    console.error("DB error listing strength history:", err);
    return Response.json({ error: "Failed to fetch history" }, { status: 500 });
  }
});

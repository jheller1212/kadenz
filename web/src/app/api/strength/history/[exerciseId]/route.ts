import { NextRequest } from "next/server";
import { getVerifiedProfileId } from "@/lib/profiles";
import { withSession } from "@/lib/api/with-session";
import { getExerciseHistory } from "../service";

// ── GET /api/strength/history/[exerciseId] ────────────────────────────────────
// Per-exercise chart data: PR-annotated metrics per completed session over
// time (heaviest set, estimated 1RM, session volume — see lib/strength/pr.ts
// for the record definitions, including bodyweight and per-hand handling).
// For Achilles exercises, also returns the pain log timeline so the UI can
// overlay pain on the load curve.
//
// The param accepts either the exercise UUID or its slug (the guided session
// only knows slugs).
//
// The query logic lives in ../service.ts (getExerciseHistory), shared with
// /api/strength/history/list, which answers the same question for every
// exercise in one pass instead of calling this route once per exercise.

export const GET = withSession(async (
  request: NextRequest,
  { params }: { params: Promise<{ exerciseId: string }> }
) => {
  const { exerciseId: idOrSlug } = await params;
  const profileId = await getVerifiedProfileId(request);
  try {
    const result = await getExerciseHistory(idOrSlug, profileId);
    if (!result) {
      return Response.json({ error: "Exercise not found" }, { status: 404 });
    }
    return Response.json(result);
  } catch (err) {
    console.error("DB error fetching exercise history:", err);
    return Response.json({ error: "Failed to fetch history" }, { status: 500 });
  }
});

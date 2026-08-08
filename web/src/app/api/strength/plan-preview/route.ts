import { z } from "zod";
import { NextRequest } from "next/server";
import { buildPlannedSession } from "@/lib/strength/service";
import { STRENGTH_SESSION_TYPES } from "@/lib/strength/types";
import { getVerifiedProfileId } from "@/lib/profiles";
import { withSession } from "@/lib/api/with-session";

// ── GET /api/strength/plan-preview?type=lower&minutes=30 ─────────────────────
//
// The exercises a given programme type would prescribe today, built exactly
// as a real session would build them — same template, same phase resolution,
// same progression against the athlete's own history, same duration fit — but
// persisting nothing.
//
// This exists for chaining (Kraft overview → "Add another block"). Creating a
// second session to read its plan was the alternative, and it is wrong twice
// over: the schedule holds one session per calendar day, and a block chained
// onto today's workout is not a second workout — it is more of this one. The
// caller appends what comes back as "added" overrides on the session it
// already has (see lib/strength/session.ts ExerciseOverride).
//
// Read-only by construction: it writes nothing, and the only athlete-specific
// inputs are the caller's own settings and history, resolved from the session
// context like every other route here.

const QuerySchema = z.object({
  type: z.enum(STRENGTH_SESSION_TYPES),
  // Omitted means "the athlete's usual length" — buildPlannedSession then
  // leaves the template's own prescription alone rather than fitting it.
  minutes: z.coerce.number().int().min(10).max(120).optional(),
});

export const GET = withSession(async (request: NextRequest) => {
  const parsed = QuerySchema.safeParse({
    type: request.nextUrl.searchParams.get("type") ?? undefined,
    minutes: request.nextUrl.searchParams.get("minutes") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 }
    );
  }

  const { type, minutes } = parsed.data;
  const profileId = await getVerifiedProfileId(request);

  const { exercises, estimatedDurationMinutes } = await buildPlannedSession(
    type,
    new Date(),
    profileId,
    minutes
  );

  return Response.json({ plannedExercises: exercises, estimatedDurationMinutes });
});

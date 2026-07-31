import { NextRequest } from "next/server";
import { z } from "zod";
import { getVerifiedProfileId } from "@/lib/profiles";
import {
  CustomWorkoutBodySchema,
  UuidSchema,
} from "@/lib/strength/custom-workout-schema";
import {
  deleteCustomWorkout,
  getCustomWorkout,
  updateCustomWorkout,
} from "@/lib/strength/custom-workouts";
import { withSession } from "@/lib/api/with-session";

type Ctx = { params: Promise<{ id: string }> };

async function parseId(ctx: Ctx): Promise<string | null> {
  const { id } = await ctx.params;
  return UuidSchema.safeParse(id).success ? id : null;
}

// GET/PUT/DELETE all resolve ownership inside the lib/strength/custom-workouts
// helpers (getCustomWorkout/updateCustomWorkout/deleteCustomWorkout), which
// filter on both the household profile and the caller's own tenant — "Not
// found" here already covers "belongs to someone else", same 404-not-403
// reasoning as lib/api/errors.ts.

export const GET = withSession(async (request: NextRequest, ctx: Ctx) => {
  const id = await parseId(ctx);
  if (!id) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    const template = await getCustomWorkout(id, await getVerifiedProfileId(request));
    if (!template) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(template);
  } catch (err) {
    console.error("[custom-workouts] get failed", err);
    return Response.json({ error: "Failed to load workout" }, { status: 500 });
  }
});

export const PUT = withSession(async (request: NextRequest, ctx: Ctx) => {
  const id = await parseId(ctx);
  if (!id) return Response.json({ error: "Not found" }, { status: 404 });

  const profileId = await getVerifiedProfileId(request);
  // Ownership before body validation, same reasoning as the strength session
  // routes: a template that isn't the caller's answers "Not found" regardless
  // of whether the body would also have failed validation.
  if (!(await getCustomWorkout(id, profileId))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  let data: z.infer<typeof CustomWorkoutBodySchema>;
  try {
    data = CustomWorkoutBodySchema.parse(await request.json());
  } catch (err) {
    return Response.json(
      { error: "Invalid request", details: err instanceof z.ZodError ? err.issues : undefined },
      { status: 400 }
    );
  }

  try {
    const template = await updateCustomWorkout(
      id,
      profileId,
      data.name,
      data.slots
    );
    if (!template) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(template);
  } catch (err) {
    console.error("[custom-workouts] update failed", err);
    return Response.json(
      { error: "Failed to update workout" },
      { status: 500 }
    );
  }
});

export const DELETE = withSession(async (request: NextRequest, ctx: Ctx) => {
  const id = await parseId(ctx);
  if (!id) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    const deleted = await deleteCustomWorkout(id, await getVerifiedProfileId(request));
    if (!deleted) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[custom-workouts] delete failed", err);
    return Response.json(
      { error: "Failed to delete workout" },
      { status: 500 }
    );
  }
});

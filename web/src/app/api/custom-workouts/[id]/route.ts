import { NextRequest } from "next/server";
import { z } from "zod";
import { getActiveProfileId } from "@/lib/profiles";
import {
  CustomWorkoutBodySchema,
  UuidSchema,
} from "@/lib/strength/custom-workout-schema";
import {
  deleteCustomWorkout,
  getCustomWorkout,
  updateCustomWorkout,
} from "@/lib/strength/custom-workouts";

type Ctx = { params: Promise<{ id: string }> };

async function parseId(ctx: Ctx): Promise<string | null> {
  const { id } = await ctx.params;
  return UuidSchema.safeParse(id).success ? id : null;
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const id = await parseId(ctx);
  if (!id) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    const template = await getCustomWorkout(id, getActiveProfileId(request));
    if (!template) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(template);
  } catch (err) {
    console.error("[custom-workouts] get failed", err);
    return Response.json({ error: "Failed to load workout" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, ctx: Ctx) {
  const id = await parseId(ctx);
  if (!id) return Response.json({ error: "Not found" }, { status: 404 });

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
      getActiveProfileId(request),
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
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const id = await parseId(ctx);
  if (!id) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    const deleted = await deleteCustomWorkout(id, getActiveProfileId(request));
    if (!deleted) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[custom-workouts] delete failed", err);
    return Response.json(
      { error: "Failed to delete workout" },
      { status: 500 }
    );
  }
}

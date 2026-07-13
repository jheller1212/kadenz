import { NextRequest } from "next/server";
import { z } from "zod";
import { getActiveProfileId } from "@/lib/profiles";
import { CustomWorkoutBodySchema } from "@/lib/strength/custom-workout-schema";
import {
  createCustomWorkout,
  listCustomWorkouts,
} from "@/lib/strength/custom-workouts";

// Auth is enforced by the proxy middleware; profile comes from the cookie.

export async function GET(request: NextRequest) {
  try {
    const templates = await listCustomWorkouts(getActiveProfileId(request));
    return Response.json(templates);
  } catch (err) {
    console.error("[custom-workouts] list failed", err);
    return Response.json({ error: "Failed to list workouts" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
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
    const template = await createCustomWorkout(
      data.name,
      getActiveProfileId(request),
      data.slots
    );
    return Response.json(template, { status: 201 });
  } catch (err) {
    console.error("[custom-workouts] create failed", err);
    return Response.json(
      { error: "Failed to create workout" },
      { status: 500 }
    );
  }
}

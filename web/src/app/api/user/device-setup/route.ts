import { NextRequest } from "next/server";
import { z } from "zod";
import { OWNER_USER_ID } from "@/db/schema";
import { getSessionUserId } from "@/lib/session";
import { CONNECTION_IDS } from "@/lib/device-setup";
import { loadDeviceSetup, saveDeviceSetup } from "@/lib/user-device-setup";
import { garminClient } from "@/lib/sync/garmin-client";

// ── /api/user/device-setup ───────────────────────────────────────────────────
// What the athlete wants connected, and which of those options it is honest to
// offer them at all.
//
// GET returns the stored answer plus `garminOffered`. That flag is computed
// here rather than in the browser because it is the one option the client
// cannot judge for itself: Garmin is not a per-user connection. It is a single
// physical watch reached through installation-level worker credentials, and
// only the owner's workouts can ever carry a garminWorkoutId. Offering it to a
// second household member would be a lie, so the server, which is the only
// side that knows who the owner is and whether the worker is deployed, decides.
//
// proxy.ts already requires a session on this path; the user id decides whose
// answer is being read or written.

const DeviceSetupSchema = z
  .object({
    // Empty is the point of the feature: it is the athlete who records by
    // hand, and it must be exactly as valid a submission as any other.
    connections: z.array(z.enum(CONNECTION_IDS)).max(CONNECTION_IDS.length),
  })
  .strict();

function garminOfferedTo(userId: string): boolean {
  return userId === OWNER_USER_ID && garminClient.isConfigured();
}

export async function GET(request: NextRequest) {
  const userId = await getSessionUserId(request.headers.get("cookie"));
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const setup = await loadDeviceSetup(userId);
    return Response.json({ ...setup, garminOffered: garminOfferedTo(userId) });
  } catch (err) {
    console.error("Device setup read error:", err);
    return Response.json({ error: "Failed to read device setup" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const userId = await getSessionUserId(request.headers.get("cookie"));
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = DeviceSetupSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 }
    );
  }

  // Same reason the flag exists: a client that offered Garmin to someone who
  // can never have it would otherwise persist a connection that does nothing,
  // and the readiness card would then wait on a baseline that never arrives.
  const garminOffered = garminOfferedTo(userId);
  const connections = parsed.data.connections.filter(
    (id) => id !== "garmin" || garminOffered
  );

  try {
    const setup = await saveDeviceSetup(userId, connections);
    return Response.json({ ...setup, garminOffered });
  } catch (err) {
    console.error("Device setup write error:", err);
    return Response.json({ error: "Failed to save device setup" }, { status: 500 });
  }
}

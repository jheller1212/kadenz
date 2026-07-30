import { NextRequest } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/session";
import { loadUserUnits, saveUserUnits } from "@/lib/user-units";

// ── /api/user/units ──────────────────────────────────────────────────────────
// The server-readable copy of the athlete's unit preference.
//
// The units screen writes localStorage first and mirrors here; that ordering
// is deliberate, since the client must not wait on a round trip to redraw a
// radio button. This copy exists for the cron, which builds the watch label,
// the calendar event and the push reminder with no browser to read.
//
// proxy.ts already requires a session on this path. The user id is what
// decides whose preference is being read or written.

const UnitsSchema = z
  .object({
    distanceUnit: z.enum(["km", "miles"]),
    weightUnit: z.enum(["kg", "lbs"]),
  })
  .strict();

export async function GET(request: NextRequest) {
  const userId = await getSessionUserId(request.headers.get("cookie"));
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    return Response.json(await loadUserUnits(userId));
  } catch (err) {
    console.error("User units read error:", err);
    return Response.json({ error: "Failed to read units" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId(request.headers.get("cookie"));
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = UnitsSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 422 });
  }

  try {
    await saveUserUnits(userId, parsed.data);
    return Response.json(parsed.data);
  } catch (err) {
    console.error("User units write error:", err);
    return Response.json({ error: "Failed to save units" }, { status: 500 });
  }
}

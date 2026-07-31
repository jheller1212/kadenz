import { NextRequest } from "next/server";
import { z } from "zod";
import { withSession } from "@/lib/api/with-session";
import { currentUserId } from "@/db/with-user";
import { loadUserUnits, saveUserUnits } from "@/lib/user-units";

// ── /api/user/units ──────────────────────────────────────────────────────────
// The server-readable copy of the athlete's unit preference.
//
// The units screen writes localStorage first and mirrors here; that ordering
// is deliberate, since the client must not wait on a round trip to redraw a
// radio button. This copy exists for the cron, which builds the watch label,
// the calendar event and the push reminder with no browser to read.
//
// proxy.ts already requires a session on this path. The user id is what decides
// whose preference is being read or written.
//
// `users` is the identity table and deliberately carries no row level security
// policy (withUser and the OAuth callback both have to read it before any
// context exists), so unlike the tenanted tables there is no database backstop
// here. The `where users.id = currentUserId()` in lib/user-units.ts is the only
// thing scoping this, which is why the id comes from withSession rather than
// being passed in as an argument that could be the wrong one.

const UnitsSchema = z
  .object({
    distanceUnit: z.enum(["km", "miles"]),
    weightUnit: z.enum(["kg", "lbs"]),
  })
  .strict();

export const GET = withSession(async () => {
  try {
    return Response.json(await loadUserUnits(currentUserId()));
  } catch (err) {
    console.error("User units read error:", err);
    return Response.json({ error: "Failed to read units" }, { status: 500 });
  }
});

export const POST = withSession(async (request) => {
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
    await saveUserUnits(currentUserId(), parsed.data);
    return Response.json(parsed.data);
  } catch (err) {
    console.error("User units write error:", err);
    return Response.json({ error: "Failed to save units" }, { status: 500 });
  }
});

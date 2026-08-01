import { type NextRequest } from "next/server";
import { geoFromHeaders } from "./service";

// ── GET /api/geo ──────────────────────────────────────────────────────────────
// Returns lat/lon from Vercel's IP geolocation headers.
// Returns 204 when headers are absent (non-Vercel env or headers not set).

export async function GET(request: NextRequest) {
  const geo = geoFromHeaders(request);
  if (!geo) return new Response(null, { status: 204 });
  return Response.json(geo);
}

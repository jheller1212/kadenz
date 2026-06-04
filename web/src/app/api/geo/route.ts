import { type NextRequest } from "next/server";

// ── GET /api/geo ──────────────────────────────────────────────────────────────
// Returns lat/lon from Vercel's IP geolocation headers.
// Returns 204 when headers are absent (non-Vercel env or headers not set).

export async function GET(request: NextRequest) {
  const lat = request.headers.get("x-vercel-ip-latitude");
  const lon = request.headers.get("x-vercel-ip-longitude");

  if (!lat || !lon) {
    return new Response(null, { status: 204 });
  }

  const latitude = parseFloat(lat);
  const longitude = parseFloat(lon);

  if (isNaN(latitude) || isNaN(longitude)) {
    return new Response(null, { status: 204 });
  }

  return Response.json({ latitude, longitude });
}

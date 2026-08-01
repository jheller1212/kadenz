import { type NextRequest } from "next/server";

// Shared with /api/today/bootstrap — Vercel's IP geolocation headers, read
// directly off the request. No database involved either way.

export function geoFromHeaders(request: NextRequest): { latitude: number; longitude: number } | null {
  const lat = request.headers.get("x-vercel-ip-latitude");
  const lon = request.headers.get("x-vercel-ip-longitude");

  if (!lat || !lon) return null;

  const latitude = parseFloat(lat);
  const longitude = parseFloat(lon);

  if (isNaN(latitude) || isNaN(longitude)) return null;

  return { latitude, longitude };
}

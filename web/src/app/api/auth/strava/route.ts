import { getAuthUrl } from "@/lib/sync/strava-client";

export async function GET() {
  try {
    return Response.redirect(getAuthUrl());
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Strava OAuth configuration error";
    return Response.json({ error: message }, { status: 503 });
  }
}

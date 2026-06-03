import { isConnected } from "@/lib/sync/strava-client";

export async function GET() {
  const connected = await isConnected();
  return Response.json({ connected });
}

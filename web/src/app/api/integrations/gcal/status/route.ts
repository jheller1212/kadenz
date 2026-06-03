import { isConnected } from "@/lib/sync/gcal-client";

export async function GET() {
  const connected = await isConnected();
  return Response.json({ connected });
}

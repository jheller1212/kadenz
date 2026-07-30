import { NextRequest } from "next/server";
import { isConnected } from "@/lib/sync/gcal-client";
import { resolveRequestUserId } from "@/lib/request-user";

// Reports the CALLER's own connection, never the installation's. A user who
// has connected nothing must see "not connected" even while someone else on
// the same install is connected. Degrades to false rather than throwing: a
// request with no resolvable identity (shouldn't happen behind proxy.ts's
// gate, but this route must never assume) is simply "not connected".
export async function GET(request: NextRequest) {
  const userId = await resolveRequestUserId(request);
  const connected = userId ? await isConnected(userId) : false;
  return Response.json({ connected });
}

import { deleteCredentials } from "@/lib/sync/credentials";
import { requireRequestUser } from "@/lib/request-user";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const { userId, response } = await requireRequestUser(request);
  if (response) return response;

  await deleteCredentials(userId, "strava");

  return Response.json({ ok: true });
}

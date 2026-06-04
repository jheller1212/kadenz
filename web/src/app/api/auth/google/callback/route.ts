import { type NextRequest, NextResponse } from "next/server";
import { createOAuth2Client, saveTokens, type GCalTokens } from "@/lib/sync/gcal-client";
import { makeSessionCookie } from "@/lib/session";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

  if (error) {
    return NextResponse.redirect(`${base}/?gcal=error`);
  }

  if (!code) {
    return Response.json({ error: "Missing authorization code" }, { status: 400 });
  }

  const oauth2Client = createOAuth2Client();

  try {
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      // Happens if user already authorized before; re-initiate with prompt=consent
      return NextResponse.redirect(`${base}/api/auth/google`);
    }

    await saveTokens({
      access_token: tokens.access_token!,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date ?? Date.now() + 3600 * 1000,
    } satisfies GCalTokens);
  } catch (err) {
    console.error("Failed to exchange Google OAuth code:", err);
    return NextResponse.redirect(`${base}/?gcal=error`);
  }

  const response = NextResponse.redirect(`${base}/?gcal=connected`);
  response.headers.set("Set-Cookie", await makeSessionCookie());
  return response;
}

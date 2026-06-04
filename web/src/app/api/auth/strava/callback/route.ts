import { type NextRequest, NextResponse } from "next/server";
import { exchangeCode, saveTokens } from "@/lib/sync/strava-client";
import { makeSessionCookie } from "@/lib/session";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

  if (error) {
    return NextResponse.redirect(`${base}/?strava=error`);
  }

  if (!code) {
    return Response.json(
      { error: "Missing authorization code" },
      { status: 400 }
    );
  }

  try {
    const tokens = await exchangeCode(code);
    await saveTokens(tokens);
  } catch (err) {
    console.error("Failed to exchange Strava OAuth code:", err);
    return NextResponse.redirect(`${base}/?strava=error`);
  }

  const response = NextResponse.redirect(`${base}/?strava=connected`);
  response.headers.set("Set-Cookie", await makeSessionCookie());
  return response;
}

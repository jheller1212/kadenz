import { type NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { exchangeCode, saveTokens } from "@/lib/sync/strava-client";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    return redirect("/?strava=error");
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
    return redirect("/?strava=error");
  }

  return redirect("/?strava=connected");
}

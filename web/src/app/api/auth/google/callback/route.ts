import { type NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { createOAuth2Client, saveTokens, type GCalTokens } from "@/lib/sync/gcal-client";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    return redirect("/?gcal=error");
  }

  if (!code) {
    return Response.json({ error: "Missing authorization code" }, { status: 400 });
  }

  const oauth2Client = createOAuth2Client();

  try {
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      // Happens if user already authorized before; re-initiate with prompt=consent
      return redirect("/api/auth/google");
    }

    await saveTokens({
      access_token: tokens.access_token!,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date ?? Date.now() + 3600 * 1000,
    } satisfies GCalTokens);
  } catch (err) {
    console.error("Failed to exchange Google OAuth code:", err);
    return redirect("/?gcal=error");
  }

  return redirect("/?gcal=connected");
}

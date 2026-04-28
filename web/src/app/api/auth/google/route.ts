import { createOAuth2Client } from "@/lib/sync/gcal-client";

export async function GET() {
  try {
    const oauth2Client = createOAuth2Client();

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/calendar.events"],
    });

    return Response.redirect(authUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : "OAuth configuration error";
    return Response.json({ error: message }, { status: 503 });
  }
}

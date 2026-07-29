import { type NextRequest, NextResponse } from "next/server";
import { exchangeCode, saveTokens } from "@/lib/sync/strava-client";
import { makeSessionCookie } from "@/lib/session";
import { isAllowedStravaAthleteId, ownerStravaAthleteId } from "@/lib/owner";
import { resolveUserForLogin } from "@/lib/users";

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

  let tokens;
  try {
    tokens = await exchangeCode(code);
  } catch (err) {
    console.error("Failed to exchange Strava OAuth code:", err);
    return NextResponse.redirect(`${base}/?strava=error`);
  }

  // Bind the session to the owner: only the allowlisted athlete may log in.
  // Checked before saveTokens so a rejected stranger cannot overwrite the
  // stored owner tokens.
  if (!isAllowedStravaAthleteId(tokens.athlete_id)) {
    return NextResponse.json(
      { error: "This Strava account is not authorized for Kadenz." },
      { status: 403 }
    );
  }

  const athleteId = String(tokens.athlete_id);

  // Null means the configuration does not say which account owns the existing
  // data and it cannot be inferred. Refuse rather than guess: guessing wrong
  // gives this login a session over every row in the database.
  const ownerAthleteId = ownerStravaAthleteId();
  if (ownerAthleteId === null) {
    console.error(
      "Cannot tell which Strava account owns Kadenz's data. Set KADENZ_OWNER_STRAVA_ID."
    );
    return NextResponse.json(
      { error: "Kadenz is misconfigured and cannot complete this login." },
      { status: 500 }
    );
  }

  let userId: string;
  try {
    userId = await resolveUserForLogin({
      provider: "strava",
      providerAccountId: athleteId,
      isOwner: athleteId === ownerAthleteId,
    });
  } catch (err) {
    console.error("Failed to resolve Strava user:", err);
    return NextResponse.redirect(`${base}/?strava=error`);
  }

  try {
    await saveTokens(tokens);
  } catch (err) {
    console.error("Failed to save Strava tokens:", err);
    return NextResponse.redirect(`${base}/?strava=error`);
  }

  const response = NextResponse.redirect(`${base}/?strava=connected`);
  response.headers.set("Set-Cookie", await makeSessionCookie(userId));
  return response;
}

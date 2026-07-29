import { type NextRequest, NextResponse } from "next/server";
import { createOAuth2Client, saveTokens, type GCalTokens } from "@/lib/sync/gcal-client";
import { makeSessionCookie } from "@/lib/session";
import { isAllowedGoogleEmail, ownerGoogleEmail } from "@/lib/owner";
import { resolveUserForLogin } from "@/lib/users";

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
  let userId: string;

  try {
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      // Happens if user already authorized before; re-initiate with prompt=consent
      return NextResponse.redirect(`${base}/api/auth/google`);
    }

    // Bind the session to the owner: verify the account's email against the
    // allowlist before doing anything with the tokens. verifyIdToken checks
    // the JWT signature/audience, so the email cannot be spoofed. Checked
    // before saveTokens so a rejected stranger cannot overwrite owner tokens.
    if (!tokens.id_token) {
      console.error("Google token exchange returned no id_token");
      return NextResponse.redirect(`${base}/?gcal=error`);
    }
    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const email = payload?.email;
    // An unverified email is a claim, not a fact: it is whatever the account
    // typed in, so matching it against the allowlist would let someone claim
    // an address they do not control.
    if (payload?.email_verified !== true) {
      console.error("Google id_token carried an unverified email");
      return NextResponse.json(
        { error: "This Google account is not authorized for Kadenz." },
        { status: 403 }
      );
    }
    if (!isAllowedGoogleEmail(email)) {
      return NextResponse.json(
        { error: "This Google account is not authorized for Kadenz." },
        { status: 403 }
      );
    }

    // The subject claim, not the email: a Google account can change its
    // email address, and the identity row has to survive that.
    const subject = payload?.sub;
    if (!subject) {
      console.error("Google id_token carried no subject claim");
      return NextResponse.redirect(`${base}/?gcal=error`);
    }

    // Null means the configuration does not say which account owns the
    // existing data and it cannot be inferred. Refuse rather than guess:
    // guessing wrong gives this login a session over every row.
    const owner = ownerGoogleEmail();
    if (owner === null) {
      console.error(
        "Cannot tell which Google account owns Kadenz's data. Set KADENZ_OWNER_GOOGLE_EMAIL."
      );
      return NextResponse.json(
        { error: "Kadenz is misconfigured and cannot complete this login." },
        { status: 500 }
      );
    }

    userId = await resolveUserForLogin({
      provider: "google",
      providerAccountId: subject,
      email,
      displayName: payload?.name ?? null,
      isOwner: (email ?? "").toLowerCase() === owner,
    });

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
  response.headers.set("Set-Cookie", await makeSessionCookie(userId));
  return response;
}

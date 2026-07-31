// GET /api/auth/email/consume -- step two, the link the athlete clicks.
//
// A GET, not a POST, because it has to be a plain clickable link in an email
// client -- there is no way to make a POST happen from clicking mail body
// text. The known tradeoff of that choice: a link-scanning proxy inside the
// recipient's mail provider (several corporate gateways prefetch links to
// scan for phishing) could consume the token before a human ever clicks,
// which would then present as "expired or already used" to the real athlete.
// Short expiry and single use bound the damage to "request a new link" rather
// than a security hole -- the scanner still has to be inside the actual
// recipient's mail flow to see the link at all, at which point it already had
// the same access a human opening the email would have. Not fixed here;
// worth knowing if "my link says already used" reports show up.
//
// Unauthenticated by necessity -- listed in src/proxy.ts's PUBLIC_API_ROUTES
// and classified "public" in e2e/specs/cross-user-isolation.spec.ts.
import { type NextRequest, NextResponse } from "next/server";
import { consumeEmailLoginToken } from "@/lib/email/tokens";
import { makeSessionCookie } from "@/lib/session";
import { isEmailSignupOpen } from "@/lib/owner";
import { resolveUserForEmailLogin, EmailSignupClosedError } from "@/lib/users";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const email = searchParams.get("email");
  const token = searchParams.get("token");
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

  if (!email || !token) {
    return NextResponse.redirect(`${base}/?email=error`);
  }

  const result = await consumeEmailLoginToken(email, token);
  if (!result.ok) {
    // Same redirect for not_found / expired / already_used -- distinguishing
    // them to the browser would tell a third party holding a copy of the URL
    // (forwarded email, browser history sync) more about the token's state
    // than a rejected link needs to reveal.
    return NextResponse.redirect(`${base}/?email=error`);
  }

  let userId;
  try {
    // resolveUserForEmailLogin decides isOwner for itself (never true -- see
    // its own comment); this route does not and must not pass owner status
    // in from anywhere.
    userId = await resolveUserForEmailLogin(result.email, isEmailSignupOpen());
  } catch (err) {
    if (err instanceof EmailSignupClosedError) {
      return NextResponse.redirect(`${base}/?email=signup_closed`);
    }
    console.error("[auth/email/consume] failed to resolve user:", err);
    return NextResponse.redirect(`${base}/?email=error`);
  }

  const response = NextResponse.redirect(`${base}/?email=connected`);
  response.headers.set("Set-Cookie", await makeSessionCookie(userId));
  return response;
}

import { type NextRequest, NextResponse } from "next/server";
import { validateSessionCookie } from "@/lib/session";

// Routes that must be reachable without a session cookie
const PUBLIC_API_ROUTES: string[] = [
  "/api/auth/strava/callback",
  "/api/auth/google/callback",
  "/api/auth/strava",
  "/api/auth/google",
  // Strava webhook — GET (subscription handshake) and POST (event delivery, HMAC-verified in handler)
  "/api/strava/webhook",
];

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  if (PUBLIC_API_ROUTES.includes(pathname)) {
    return NextResponse.next();
  }

  // Vercel cron invocations authenticate with CRON_SECRET, not a session.
  // The route re-verifies the same header; this just lets it through the gate.
  if (pathname.startsWith("/api/cron/")) {
    const secret = process.env.CRON_SECRET;
    if (secret && request.headers.get("authorization") === `Bearer ${secret}`) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cookieHeader = request.headers.get("cookie");
  const valid = await validateSessionCookie(cookieHeader);
  if (!valid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};

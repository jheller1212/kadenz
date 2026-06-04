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

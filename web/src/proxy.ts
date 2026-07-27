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

// Maintenance/reconcile routes that document (and implement) CRON_SECRET
// bearer auth as an alternative to a session cookie, same as /api/cron/*.
// An explicit allowlist rather than a prefix match: widening what gets the
// CRON_SECRET exemption should always be a deliberate one-line edit here,
// never an accident of where a new route file happens to live. Each route
// re-verifies the same header itself — this only lets it through the gate.
const CRON_AUTHENTICATED_ROUTES: string[] = [
  "/api/sync/reconcile-garmin",
  "/api/sync/reconcile-archived-plans",
  "/api/sync/reconcile-gcal-outbox",
  "/api/garmin/reconcile",
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
  if (pathname.startsWith("/api/cron/") || CRON_AUTHENTICATED_ROUTES.includes(pathname)) {
    const secret = process.env.CRON_SECRET;
    // Fail closed: an unset or empty CRON_SECRET must never grant access,
    // even if a caller sends a literal "Bearer " header with nothing after it.
    if (secret && request.headers.get("authorization") === `Bearer ${secret}`) {
      return NextResponse.next();
    }
    // The owner may also force a run from a signed-in session — waiting a
    // full day for the next cron is no way to recover a wedged queue.
    if (await validateSessionCookie(request.headers.get("cookie"))) {
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

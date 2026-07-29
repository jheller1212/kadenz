import { type NextRequest, NextResponse } from "next/server";
import { getShellTokenUserId, validateSessionCookie } from "@/lib/session";

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

// Origins allowed to call this API from another origin, as an exact-match
// comma-separated list. Empty by default, which leaves CORS entirely off and
// the API same-origin only, exactly as it has always been.
//
// The native shell needs this: it serves the UI from local files in the
// WebView, so its origin is `capacitor://localhost` (iOS) or `http://localhost`
// (Android) while the API stays on Vercel. An allowlist rather than a wildcard
// because these responses are credentialed, and `Access-Control-Allow-Origin: *`
// is not permitted with credentials for exactly that reason.
function allowedOrigins(): string[] {
  return (process.env.SHELL_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/** The origin to echo back, or null if this request gets no CORS headers. */
function corsOrigin(request: NextRequest): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  return allowedOrigins().includes(origin) ? origin : null;
}

function applyCors(response: NextResponse, origin: string): NextResponse {
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Credentials", "true");
  // Caches must not serve one origin's response to another.
  response.headers.append("Vary", "Origin");
  return response;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const origin = corsOrigin(request);

  // Answer the preflight before the session check, not after. A preflight is
  // sent by the browser with no cookies and no credentials by design, so
  // running it through the gate below would 401 every cross-origin request
  // before the real one was ever made.
  if (request.method === "OPTIONS") {
    if (!origin) {
      return new NextResponse(null, { status: 403 }) as NextResponse;
    }
    const preflight = new NextResponse(null, { status: 204 });
    applyCors(preflight, origin);
    preflight.headers.set(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,PATCH,DELETE,OPTIONS"
    );
    preflight.headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
    preflight.headers.set("Access-Control-Max-Age", "86400");
    return preflight;
  }

  if (PUBLIC_API_ROUTES.includes(pathname)) {
    return origin ? applyCors(NextResponse.next(), origin) : NextResponse.next();
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

  // A session cookie, or the native shell's bearer token. The shell runs on a
  // capacitor:// origin, so the SameSite=Lax cookie is never sent with its
  // requests; the token is how it identifies itself instead. Both resolve to a
  // user id through lib/session.ts, and the route resolves the same id again
  // via lib/request-user.ts — this gate proves the caller is someone, the
  // route decides whose data it may touch.
  //
  // Deliberately NOT accepted on the cron branch above: a shell token is a
  // user credential and must not open maintenance endpoints that run with
  // installation-wide authority.
  const authenticated =
    (await validateSessionCookie(request.headers.get("cookie"))) ||
    Boolean(await getShellTokenUserId(request.headers.get("authorization")));

  if (!authenticated) {
    // The 401 gets CORS headers too. Without them the shell's fetch rejects
    // with an opaque network error instead of a 401, and apiFetch never fires
    // the unauthorized event that surfaces the Connect screen.
    const denied = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return origin ? applyCors(denied, origin) : denied;
  }

  return origin ? applyCors(NextResponse.next(), origin) : NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};

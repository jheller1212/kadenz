import { type NextRequest } from "next/server";
import {
  SHELL_TOKEN_MAX_AGE_SECONDS,
  makeShellToken,
} from "@/lib/session";
import { resolveRequestUserId } from "@/lib/request-user";

// ── POST /api/auth/shell/token ────────────────────────────────────────────────
// Mints the bearer token the native shell uses for its API calls.
//
// Two ways in, both handled by resolveRequestUserId:
//   • a session cookie, for a browser that is already signed in
//   • a still-valid shell token, which is how a shell rotates before its
//     current token lapses without sending the athlete back through login
//
// A lapsed token cannot be rotated. That is the cost of the one-day lifetime
// and also the point of it: a token copied off the device is useless within a
// day.
//
// ── What this does NOT yet do, and why ───────────────────────────────────────
//
// It does not give the Capacitor shell (#114) a way to obtain its FIRST token.
// The shell static-exports the front end and runs it from a local bundle
// (native/capacitor.config.ts: webDir ../web/out, androidScheme https), so its
// origin is localhost, not the Kadenz origin. There is no webview on our
// domain and therefore no session cookie anywhere the shell's JavaScript can
// use to call this route.
//
// Closing that needs the OAuth flow to be told it was started by the shell
// (a marker carried through the OAuth `state` parameter) so the callback can
// mint a token and hand it back over a custom-scheme deep link instead of
// setting a cookie and redirecting. That is a change to both provider
// callbacks, which are also where the per-user token fix lands, so it is
// deliberately kept out of this change rather than bundled into it.
//
// So: the verification half of the bearer path is complete and proven, the
// issuing half is complete for a signed-in browser, and shell enrolment is the
// remaining piece. Do not read this route as "the shell can authenticate".
//
// No route-local auth check beyond the resolve below: proxy.ts already requires
// one of the two credentials to reach here, and identity is resolved again
// because the gate only proves the caller is somebody, not who.

export async function POST(request: NextRequest) {
  const userId = await resolveRequestUserId(request);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const token = await makeShellToken(userId);
    return Response.json({
      token,
      // Seconds, so the shell can schedule its own refresh rather than waiting
      // for a 401 to tell it.
      expiresIn: SHELL_TOKEN_MAX_AGE_SECONDS,
    });
  } catch (err) {
    // The only realistic failure is a missing SESSION_SECRET, which is a
    // deployment fault and must not be echoed to the caller.
    console.error("Shell token mint error:", err);
    return Response.json({ error: "Failed to mint token" }, { status: 500 });
  }
}

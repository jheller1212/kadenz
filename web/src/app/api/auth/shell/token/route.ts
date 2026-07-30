import { type NextRequest } from "next/server";
import {
  SHELL_TOKEN_MAX_AGE_SECONDS,
  makeShellToken,
} from "@/lib/session";
import { resolveRequestUserId } from "@/lib/request-user";

// ── POST /api/auth/shell/token ────────────────────────────────────────────────
// Mints the bearer token the native shell uses for its API calls.
//
// The shell loads the app in a webview on the Kadenz origin, where the login
// flow works normally and the session cookie is first-party. It calls this
// route once from there to get a token, stores it, and sends it as
// Authorization on every request it makes from native code, where the cookie
// would not be sent (SameSite=Lax).
//
// Two ways in, both handled by resolveRequestUserId:
//   • a session cookie, which is how the first token is obtained
//   • a still-valid shell token, which is how the shell rotates on launch
//     without sending the athlete back through login
//
// A lapsed token cannot be rotated. That is the cost of a one-day lifetime and
// it is the point of it: the shell falls back to the webview login it already
// has, and a token copied off the device is useless within a day.
//
// No route-local auth check: proxy.ts already requires one of those two
// credentials to reach here, and the identity is resolved again below because
// the gate only proves the caller is somebody, not who.

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

// Mints a valid session cookie using the app's own helper
// (src/lib/session.ts's makeSessionCookie) and prints one "name=value" pair
// per line to stdout, one per user id passed on the command line. Run as a
// separate `tsx` process by global-setup.ts rather than imported in-process,
// because dynamically importing this ESM module tree from Playwright's
// CJS-compiled global-setup hits a "Cannot require() ES Module ... in a
// cycle" error (Node's require(esm) interop limitation) — the same reason
// e2e/seed.ts is spawned rather than imported.
//
// This is the whole "auth bypass": there isn't one. It calls the exact same
// function the Strava/Google OAuth callback calls to mint a session, using a
// SESSION_SECRET that only ever exists in this local e2e process. Zero
// changes to app code. Minting for a second user id is not a new bypass
// either — makeSessionCookie takes whatever user id it's given in production
// too (that's how the OAuth callback signs in the athlete who just
// authenticated); this script just calls it a second time with a different,
// already-seeded id instead of leaving every spec running as one user.
import { makeSessionCookie } from "../src/lib/session";
import { asUserId } from "../src/lib/user-id";
import { OWNER_USER_ID } from "../src/db/schema";

async function main() {
  if (!process.env.SESSION_SECRET) {
    throw new Error("[mint-cookie] SESSION_SECRET must be set — refusing to run without it.");
  }
  // Defaults to the owner (e2e/seed.ts's primary user) when called with no
  // args, same as before this file supported more than one user.
  const userIds = process.argv.slice(2);
  if (userIds.length === 0) userIds.push(OWNER_USER_ID);

  const lines: string[] = [];
  for (const userId of userIds) {
    // Ids arrive as argv strings, so this is the boundary. asUserId rejects
    // anything that is not a uuid rather than minting a session for it.
    const setCookieHeader = await makeSessionCookie(asUserId(userId));
    const [nameValue] = setCookieHeader.split(";");
    lines.push(nameValue.trim());
  }
  process.stdout.write(lines.join("\n"));
}

main().catch((err) => {
  console.error("[mint-cookie] failed:", err);
  process.exit(1);
});

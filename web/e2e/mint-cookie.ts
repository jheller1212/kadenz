// Mints a valid session cookie using the app's own helper
// (src/lib/session.ts's makeSessionCookie) and prints just the "name=value"
// pair to stdout. Run as a separate `tsx` process by global-setup.ts rather
// than imported in-process, because dynamically importing this ESM module
// tree from Playwright's CJS-compiled global-setup hits a
// "Cannot require() ES Module ... in a cycle" error (Node's require(esm)
// interop limitation) — the same reason e2e/seed.ts is spawned rather than
// imported.
//
// This is the whole "auth bypass": there isn't one. It calls the exact same
// function the Strava/Google OAuth callback calls to mint a session, using a
// SESSION_SECRET that only ever exists in this local e2e process. Zero
// changes to app code.
import { makeSessionCookie } from "../src/lib/session";

async function main() {
  if (!process.env.SESSION_SECRET) {
    throw new Error("[mint-cookie] SESSION_SECRET must be set — refusing to run without it.");
  }
  const setCookieHeader = await makeSessionCookie();
  const [nameValue] = setCookieHeader.split(";");
  process.stdout.write(nameValue.trim());
}

main().catch((err) => {
  console.error("[mint-cookie] failed:", err);
  process.exit(1);
});

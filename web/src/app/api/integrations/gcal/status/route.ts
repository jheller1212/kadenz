import { isConnected, loadGCalConnectionIssue } from "@/lib/sync/gcal-client";
import { withSession } from "@/lib/api/with-session";
import { currentUserId } from "@/db/with-user";

// Reports the CALLER's own connection, never the installation's. A user who
// has connected nothing must see "not connected" even while someone else on
// the same install is connected.
//
// isConnected reads integration_credentials (Phase 4, tenanted, FORCE row
// level security). Without withSession opening the request's transaction and
// setting app.user_id, that read matches zero rows for everyone, and this
// route silently answered "not connected" even for a connected user. Same
// shape and same fix as strava/disconnect.
//
// needsReconnect distinguishes "never connected" from "was connected, then
// auto-disconnected because the grant died" (see markGCalDisconnected in
// gcal-client.ts) — same underlying `connected: false`, but a different
// message and, on the settings UI, a different badge.
export const GET = withSession(async () => {
  const userId = currentUserId();
  const [connected, issue] = await Promise.all([
    isConnected(userId),
    loadGCalConnectionIssue(userId),
  ]);
  return Response.json({ connected, needsReconnect: !connected && issue !== null });
});

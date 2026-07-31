import { deleteCredentials } from "@/lib/sync/credentials";
import { withSession } from "@/lib/api/with-session";
import { currentUserId } from "@/db/with-user";

// integration_credentials is tenanted (Phase 4) and FORCE row level security
// means a DELETE with no context matches zero rows and still reports success
// (see drizzle/0066_rls_covers_every_tenanted_table.sql). This used to call
// deleteCredentials on the pooled connection via requireRequestUser, which
// resolves an identity but opens no transaction — the row never actually
// went away, so "disconnect" silently left the athlete's tokens in place.
// withSession is what opens that transaction and sets app.user_id on it.
export const POST = withSession(async () => {
  await deleteCredentials(currentUserId(), "strava");

  return Response.json({ ok: true });
});

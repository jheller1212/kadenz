import { db, syncOutbox } from "@/db";
import { eq } from "drizzle-orm";
import { withSession } from "@/lib/api/with-session";

const TOKEN_IDEM_KEY = "gcal:tokens:singleton";

// sync_outbox is tenanted (Phase 3) — withSession's row level security
// context means this delete only ever removes the CALLER's own stored
// tokens row, never another user's, even though idempotencyKey itself is a
// global key (see gcal-client.ts's token storage comment).
export const POST = withSession(async () => {
  await db
    .delete(syncOutbox)
    .where(eq(syncOutbox.idempotencyKey, TOKEN_IDEM_KEY));

  return Response.json({ ok: true });
});

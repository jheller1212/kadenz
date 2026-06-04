import { db, syncOutbox } from "@/db";
import { eq } from "drizzle-orm";

const TOKEN_IDEM_KEY = "gcal:tokens:singleton";

export async function POST() {
  await db
    .delete(syncOutbox)
    .where(eq(syncOutbox.idempotencyKey, TOKEN_IDEM_KEY));

  return Response.json({ ok: true });
}

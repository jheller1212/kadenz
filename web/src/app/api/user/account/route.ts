import { z } from "zod";
import { withSession } from "@/lib/api/with-session";
import { currentUserId } from "@/db/with-user";
import { clearSessionCookie } from "@/lib/session";
import { deleteAccount, OwnerCannotSelfDeleteError } from "@/lib/account-deletion";

// ── DELETE /api/user/account ─────────────────────────────────────────────────
// Both app stores require an in-app account deletion path, and GDPR requires
// an actual erase rather than a flag. This is that path.
//
// There is no id in the request -- it always deletes the CALLER's own
// account, resolved from the session by withSession, never from anything the
// client sends -- so there is no cross-user id to attack here the way a
// tenanted-id route has. See lib/account-deletion.ts for the actual erase
// (every tenanted table, discovered rather than hand-listed, plus identities,
// plus the user row itself) and its owner guard.
//
// Confirmation is a literal typed string, not a boolean, on purpose: a
// boolean is one stray `true` in a request body away from firing by accident
// (a client bug, a replayed request, a form default), and this action cannot
// be undone. Typing the phrase is the same bar GitHub uses for repo deletion.
const DeleteAccountSchema = z
  .object({ confirmation: z.literal("DELETE MY ACCOUNT") })
  .strict();

export const DELETE = withSession(async (request) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = DeleteAccountSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error:
          'Send { "confirmation": "DELETE MY ACCOUNT" } to confirm. This cannot be undone.',
      },
      { status: 422 }
    );
  }

  try {
    await deleteAccount(currentUserId());
  } catch (err) {
    if (err instanceof OwnerCannotSelfDeleteError) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    console.error("Account deletion error:", err);
    return Response.json({ error: "Failed to delete account" }, { status: 500 });
  }

  // Signed out as part of the same response: the session cookie still decodes
  // to a valid-looking user id after this (session validity doesn't depend on
  // the users row existing), so leaving it set would let the browser keep
  // sending it to routes that would now legitimately 500 or 401 depending on
  // what they touch, instead of cleanly landing back on the sign-in screen.
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": clearSessionCookie(),
    },
  });
});

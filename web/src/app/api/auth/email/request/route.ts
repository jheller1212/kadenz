// POST /api/auth/email/request -- step one of magic-link sign-in.
//
// Unauthenticated by necessity (nobody has a session yet) -- listed in
// src/proxy.ts's PUBLIC_API_ROUTES with a comment there, and classified
// "public" in e2e/specs/cross-user-isolation.spec.ts.
//
// ── The leak this must not have ───────────────────────────────────────────────
// This handler never asks "does an account exist for this email" -- there is
// no query against `users` or `user_identities` anywhere below. A token is
// minted and an email sent (or not, if rate-limited) purely as a function of
// the address's shape and its recent request volume, never its account
// status. That is what makes "known vs unknown address gets the same
// response" true by construction rather than by remembering to return the
// same thing from two different branches.
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createEmailLoginToken, normalizeEmail } from "@/lib/email/tokens";
import { checkEmailRateLimit } from "@/lib/email/rate-limit";
import { getEmailSender } from "@/lib/email/sender";

const BodySchema = z.object({
  email: z.string().trim().min(3).max(254).email(),
});

/** Best-effort caller IP from the header Vercel (and most proxies) set. */
function callerIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

export async function POST(request: NextRequest) {
  const raw = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    // A format error, not an existence check -- refusing "not-an-email" leaks
    // nothing about any account.
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const email = normalizeEmail(parsed.data.email);
  const ip = callerIp(request);

  const rateLimit = await checkEmailRateLimit(email, ip);
  if (rateLimit.limited) {
    // 429 varies only with request VOLUME for this address/IP, never with
    // whether the address has an account -- an attacker sending the same
    // address twice learns nothing they didn't already know (that they sent
    // it twice).
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429 }
    );
  }

  const token = await createEmailLoginToken(email, ip);
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const link = `${base}/api/auth/email/consume?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;

  try {
    await getEmailSender().send({
      to: email,
      subject: "Sign in to Kadenz",
      text:
        `Use this link to sign in to Kadenz. It expires in 15 minutes and works once.\n\n${link}\n\n` +
        "If you didn't request this, ignore this email.",
    });
  } catch (err) {
    // The token row already exists and will just expire unused -- logging
    // and still returning ok:true keeps this response identical to the
    // success path, so a delivery failure (misconfigured Resend, say) is
    // not itself something a caller can distinguish from a known-vs-unknown
    // address. Real failures are visible in the server logs, not the wire.
    console.error("[auth/email/request] failed to send magic link:", err);
  }

  return NextResponse.json({ ok: true });
}

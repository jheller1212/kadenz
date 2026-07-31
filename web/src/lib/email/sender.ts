// Email delivery, behind an interface so it is testable without sending real
// mail. Nothing in tokens.ts or the routes talks to Resend directly.
//
// ── Provider ───────────────────────────────────────────────────────────────
//
// Resend, via a plain `fetch` to its HTTP API rather than the `resend` npm
// package -- one POST request is the whole integration, and it keeps this
// change dependency-free. RESEND_API_KEY comes from env and is checked at the
// point of sending, not at import time (import-time throws break `next
// build`, which imports every route module to collect page data but never
// sends anything -- see db/index.ts for the same reasoning about
// DATABASE_URL).
//
// ── What Jonas must supply for real delivery ──────────────────────────────────
//
// 1. RESEND_API_KEY (Resend dashboard -> API Keys).
// 2. A verified sending domain in Resend, and EMAIL_FROM set to an address on
//    it (e.g. "Kadenz <login@mail.kadenz-tau.vercel.app>" or a custom domain).
//    Sending from an unverified domain either fails outright or lands in spam.
// 3. SPF, DKIM, and DMARC DNS records on that domain -- Resend's domain setup
//    screen generates the exact records to add once the domain is entered.
//    Without them most providers (Gmail especially) will junk or reject the
//    message outright, magic link or not.
//
// This module cannot verify any of the above: there is no sending domain
// configured in this environment, so delivery has not been (and could not be)
// exercised against a real inbox. What IS exercised: DevLoggingEmailSender
// below (used automatically when RESEND_API_KEY is unset outside production)
// and the fake sender the tests use.

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

class ResendEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    // Checked here, not at module load, so a build with no key never fails --
    // only an actual attempt to send does, and it fails loudly rather than
    // silently dropping the email (see the module comment above).
    if (!apiKey) {
      throw new Error("RESEND_API_KEY env var is not set. Cannot send email.");
    }
    if (!from) {
      throw new Error("EMAIL_FROM env var is not set. Cannot send email.");
    }

    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Resend send failed: ${res.status} ${body}`);
    }
  }
}

/**
 * Logs the message (magic link included) instead of sending it. This is what
 * runs in local/preview dev without RESEND_API_KEY set, and it is the only
 * path this change could actually exercise end to end without a configured
 * sending domain.
 */
class DevLoggingEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    console.log(
      `[email:dev] would send to ${message.to} -- subject: "${message.subject}"\n${message.text}`
    );
  }
}

let cached: EmailSender | null = null;

/**
 * The sender to use for this process. RESEND_API_KEY present => Resend, real
 * mail. Absent outside production => logs instead of sending, so local dev
 * and preview deploys without the secret still work end to end. Absent IN
 * production => throws; a magic link that was never sent must never look
 * like it was.
 */
export function getEmailSender(): EmailSender {
  if (cached) return cached;
  if (process.env.RESEND_API_KEY) {
    cached = new ResendEmailSender();
    return cached;
  }
  if (process.env.NODE_ENV !== "production") {
    cached = new DevLoggingEmailSender();
    return cached;
  }
  throw new Error(
    "RESEND_API_KEY env var is not set. Refusing to silently no-op in production."
  );
}

/** Test-only seam: replace the cached sender, or clear it to re-resolve. */
export function __setEmailSenderForTest(sender: EmailSender | null): void {
  cached = sender;
}

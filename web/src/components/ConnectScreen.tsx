"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Activity, CalendarDays, Dumbbell, Mail } from "lucide-react";
import { KadenzMark } from "@/components/ui/KadenzMark";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";

// Full-screen sign-in / onboarding shown when the app has no valid session.
// Connecting Strava mints the session cookie (see api/auth/strava/callback);
// the email flow below mints one too, via api/auth/email/consume, once the
// athlete clicks the link that route sent them.
//
// "email" state names:
//   idle    -- email input, nothing sent yet
//   sending -- POST in flight
//   sent    -- "check your inbox", the request always ends up here (or on a
//              client-side validation error) so a known address can't be told
//              apart from an unknown one -- see api/auth/email/request.
type EmailState = "idle" | "sending" | "sent";

// The three outcomes api/auth/email/consume redirects back here with. It
// deliberately does not distinguish expired/already-used/invalid token (see
// that route's comment on why), so neither does this banner -- "error" covers
// all three with one message rather than inventing a distinction the API
// doesn't make.
type ConsumeResult = "connected" | "error" | "signup_closed" | null;

export function ConnectScreen() {
  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState("");
  const [emailState, setEmailState] = useState<EmailState>("idle");
  const [requestError, setRequestError] = useState<string | null>(null);
  const [consumeResult, setConsumeResult] = useState<ConsumeResult>(null);

  // Read once on mount: the ?email= param from a consume redirect. Cleared
  // from the URL right after so a refresh doesn't re-show a stale banner.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const result = params.get("email");
    if (result === "connected" || result === "error" || result === "signup_closed") {
      // Reads the URL a consume redirect landed on, client-only -- same
      // pattern as the pendingWrites refresh in GuidedSession.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConsumeResult(result);
      params.delete("email");
      const rest = params.toString();
      window.history.replaceState(null, "", rest ? `?${rest}` : window.location.pathname);
    }
  }, []);

  async function requestLink(e: React.FormEvent) {
    e.preventDefault();
    setRequestError(null);
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@")) {
      setRequestError("Enter a valid email address.");
      return;
    }
    setEmailState("sending");
    try {
      const res = await apiFetch("/api/auth/email/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      if (res.status === 429) {
        setRequestError("Too many requests. Try again in a few minutes.");
        setEmailState("idle");
        return;
      }
      if (!res.ok) {
        // Only reachable for a malformed address the server rejects that the
        // client check above missed -- a real account/no-account outcome is
        // never distinguishable here, see the route.
        setRequestError("Enter a valid email address.");
        setEmailState("idle");
        return;
      }
      // Same "sent" state regardless of whether this address has an account
      // -- do not add a branch here for "unknown email", there is nothing to
      // branch on (see api/auth/email/request's comment).
      setEmailState("sent");
    } catch {
      setRequestError("Couldn't reach the server. Check your connection.");
      setEmailState("idle");
    }
  }

  return (
    <main className="min-h-dvh flex flex-col bg-bg px-6 safe-top">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 22 }}
          className="mb-6 flex h-20 w-20 items-center justify-center rounded-[26%]"
          style={{ background: "var(--k-signature-grad)" }}
        >
          <KadenzMark className="h-11 w-11 text-[#0B0B0F]" />
        </motion.div>
        <h1 className="font-display text-[38px] uppercase tracking-[0.04em] text-text-1">Kadenz</h1>
        <p className="mt-2 max-w-[280px] text-[15px] leading-relaxed text-text-2">
          A running plan and a real strength programme, both built around the training you actually do.
        </p>

        <div className="mt-9 flex w-full max-w-[300px] flex-col gap-3 text-left">
          <Feature icon={<CalendarDays className="h-5 w-5" />} text="Weekly plans that adapt to your real runs" />
          <Feature icon={<Dumbbell className="h-5 w-5" />} text="Kraft strength, coupled to your running phase" />
          <Feature icon={<Activity className="h-5 w-5" />} text="Auto-synced from Strava, no manual logging" />
        </div>

        {consumeResult === "error" && (
          <p className="mt-6 max-w-[280px] rounded-[var(--radius-input)] bg-danger/10 px-3.5 py-2 text-[13px] font-medium text-danger">
            That link is invalid or has expired. Request a new one below.
          </p>
        )}
        {consumeResult === "signup_closed" && (
          <p className="mt-6 max-w-[280px] rounded-[var(--radius-input)] bg-warn/10 px-3.5 py-2 text-[13px] font-medium text-warn">
            Email sign-up isn&apos;t open yet. If you already have a Kadenz account, sign in with Strava, or ask Jonas for access.
          </p>
        )}
      </div>

      <div className="pb-[max(env(safe-area-inset-bottom),24px)] pt-4">
        <motion.a
          href="/api/auth/strava"
          whileTap={{ scale: 0.97 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className="flex h-14 w-full items-center justify-center gap-2.5 rounded-full bg-[#FC4C02] text-[16px] font-bold text-white"
          style={{ touchAction: "manipulation" }}
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
          </svg>
          Continue with Strava
        </motion.a>

        {!showEmail ? (
          <button
            type="button"
            onClick={() => setShowEmail(true)}
            style={{ touchAction: "manipulation" }}
            className="mt-3 flex h-12 w-full items-center justify-center gap-2 text-[15px] font-semibold text-text-2"
          >
            <Mail className="h-4 w-4" strokeWidth={2.2} />
            Continue with email
          </button>
        ) : emailState === "sent" ? (
          <div className="mt-3 rounded-[var(--radius-input)] bg-elevated px-4 py-3 text-center">
            <p className="text-[14px] font-semibold text-text-1">Check your inbox</p>
            <p className="mt-1 text-[13px] leading-snug text-text-2">
              If {email.trim()} has a Kadenz account, a sign-in link is on its way. It expires in 15 minutes and works once.
            </p>
            {/* Dev-only: no RESEND_API_KEY means DevLoggingEmailSender wrote
                the link to the server console instead of sending it (see
                lib/email/sender.ts) -- surface that here so a developer
                looking at a "sent" screen with no email arriving knows where
                to look instead of assuming delivery is broken. process.env.
                NODE_ENV is inlined at build time, so this line does not ship
                in a production bundle. */}
            {process.env.NODE_ENV !== "production" && (
              <p className="mt-2 text-[12px] font-medium text-accent-fg">
                Dev mode: no RESEND_API_KEY set, so the link was logged to the server console instead of emailed.
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                setEmailState("idle");
                setEmail("");
              }}
              style={{ touchAction: "manipulation" }}
              className="mt-3 text-[13px] font-semibold text-accent-fg"
            >
              Use a different address
            </button>
          </div>
        ) : (
          <form onSubmit={requestLink} className="mt-3 flex flex-col gap-2">
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-xl bg-elevated px-4 py-3 text-[15px] text-text-1 placeholder:text-text-3 outline-none focus:ring-2 focus:ring-accent"
            />
            {requestError && <p className="text-[13px] font-medium text-danger">{requestError}</p>}
            <Button type="submit" variant="secondary" size="lg" full busy={emailState === "sending"}>
              Send sign-in link
            </Button>
          </form>
        )}

        <p className="mt-3 text-center text-[12px] leading-snug text-text-3">
          {showEmail && emailState !== "sent"
            ? "We'll email you a link to sign in. No password needed."
            : "Signing in with Strava connects your activities and keeps you logged in on this device."}
        </p>
      </div>
    </main>
  );
}

function Feature({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-accent-fg">
        {icon}
      </span>
      <span className="text-[14px] font-medium text-text-1">{text}</span>
    </div>
  );
}

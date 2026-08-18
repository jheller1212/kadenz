"use client";

import { useEffect, useState } from "react";
import { CalendarDays, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";

// ── "Your calendar needs reconnecting" ──────────────────────────────────────
//
// When a Google grant dies, the app already does the right things: it stops
// retrying, disconnects once, and records why (markGCalDisconnected). What it
// never did was TELL anyone. Sync simply stopped, and the only way to find out
// was to notice missing calendar events and go looking in Settings.
//
// That is not a hypothetical gap: a dead grant went unnoticed for four days,
// and the athlete only discovered it while chasing an unrelated cron failure.
//
// Deliberately narrow. It renders nothing at all unless the calendar was
// connected and the grant has since died — the state the status endpoint calls
// `needsReconnect`. Someone who has never connected a calendar is not nagged
// to; that is a settings choice, not a problem to fix.
//
// Failures are silent by design. This is a notice ABOUT a background feature,
// so a hiccup fetching it must never put an error on the athlete's Today
// screen — worst case they see nothing, which is exactly what they saw before
// this existed.

const DISMISS_KEY = "kadenz:gcal-reconnect-dismissed-at";
// Dismissing hides it for a day, not forever: the condition is real and
// unresolved, so it should come back. A permanent dismiss would recreate the
// silence this exists to end.
const DISMISS_HOURS = 24;

export function CalendarReconnectBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    if (dismissedAt && Date.now() - dismissedAt < DISMISS_HOURS * 3600_000) return;

    apiFetch("/api/integrations/gcal/status")
      .then((r: Response) => (r.ok ? r.json() : null))
      .then((d: { needsReconnect?: boolean } | null) => {
        if (!cancelled && d?.needsReconnect) setShow(true);
      })
      .catch(() => {
        // Swallowed on purpose — see the note above.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!show) return null;

  return (
    <div className="mx-5 flex items-start gap-3 rounded-[var(--radius-card)] bg-warn/10 p-3.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warn/20">
        <CalendarDays className="h-4 w-4 text-warn" strokeWidth={2} />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold text-text-1">Calendar needs reconnecting</p>
        <p className="mt-0.5 text-[13px] leading-snug text-text-3">
          Google signed Kadenz out, so your workouts aren&apos;t reaching your calendar.
        </p>
        <a
          href="/api/auth/google"
          onClick={() => haptic("medium")}
          className="press mt-2.5 inline-flex rounded-full bg-warn px-4 py-1.5 text-[13px] font-semibold text-on-accent"
        >
          Reconnect
        </a>
      </div>

      <button
        onClick={() => {
          haptic("light");
          localStorage.setItem(DISMISS_KEY, String(Date.now()));
          setShow(false);
        }}
        aria-label="Dismiss"
        className="press -m-1 shrink-0 p-1 text-text-3"
      >
        <X className="h-4 w-4" strokeWidth={2} />
      </button>
    </div>
  );
}

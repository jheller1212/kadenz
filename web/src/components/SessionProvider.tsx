"use client";

import { useEffect, useState, type ReactNode } from "react";
import { UNAUTHORIZED_EVENT } from "@/lib/api";
import { ConnectScreen } from "@/components/ConnectScreen";

type State = "checking" | "authed" | "guest";

// Gates the whole app: probes /api/session on mount, shows the Connect screen
// when there's no valid session, and flips to it if any API call 401s (so a
// stale/expired session never leaves the user staring at a silently-broken UI).
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>("checking");

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch("/api/session", { cache: "no-store" });
        if (alive) setState(res.ok ? "authed" : "guest");
      } catch {
        // Network/offline: don't lock the user out — assume authed and let
        // individual screens handle their own failures.
        if (alive) setState("authed");
      }
    };
    check();

    const onUnauthorized = () => setState("guest");
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    // Re-check when returning to the tab (e.g. back from the Strava OAuth flow).
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive = false;
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (state === "checking") {
    // Brief splash — matches the app background so there's no white flash.
    return <div className="min-h-dvh bg-bg" />;
  }
  if (state === "guest") return <ConnectScreen />;
  return <>{children}</>;
}

"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import { UNAUTHORIZED_EVENT } from "@/lib/api";
import { ConnectScreen } from "@/components/ConnectScreen";
import { BootSplash } from "@/components/BootSplash";

type State = "checking" | "authed" | "guest";

// Gates the whole app: probes /api/session on mount, shows the Connect screen
// when there's no valid session, and flips to it if any API call 401s (so a
// stale/expired session never leaves the user staring at a silently-broken UI).
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>("checking");
  // Kept separate from `state` so the splash stays mounted across the
  // checking → resolved swap and can cross-fade out over the first painted
  // frame instead of cutting.
  const [splashGone, setSplashGone] = useState(false);

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

  // Let the resolved screen paint one frame underneath, then fade the splash.
  // rAF is throttled to zero in a background tab, so a timer backs it up —
  // otherwise booting in an unfocused tab would strand the user behind the
  // splash until they focused it.
  useEffect(() => {
    if (state === "checking") return;
    const raf = requestAnimationFrame(() => setSplashGone(true));
    const timer = window.setTimeout(() => setSplashGone(true), 400);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [state]);

  return (
    <>
      {state === "guest" ? <ConnectScreen /> : state === "authed" ? children : null}
      <AnimatePresence>{!splashGone && <BootSplash />}</AnimatePresence>
    </>
  );
}

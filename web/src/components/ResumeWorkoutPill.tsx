"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { loadGuidedSnapshot } from "@/lib/strength/guided-snapshot";

// Floating "get back to your workout" pill, visible on every screen with the
// tab bar while a guided session is parked. Hidden on /strength itself — the
// running session / resume card lives there.
export function ResumeWorkoutPill() {
  const pathname = usePathname();
  const [title, setTitle] = useState<string | null>(null);

  useEffect(() => {
    function check() {
      const snap = loadGuidedSnapshot();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is client-only
      setTitle(snap ? snap.session.title : null);
    }
    check();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("storage", check);
    const interval = setInterval(check, 15_000);
    return () => {
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("storage", check);
      clearInterval(interval);
    };
  }, []);

  if (!title || pathname.startsWith("/strength")) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-40 mx-auto flex max-w-[430px] justify-center px-5"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 64px)" }}
    >
      <TransitionLink
        href="/strength"
        className="press pointer-events-auto flex max-w-full items-center gap-2.5 rounded-full bg-accent px-4 py-2.5 shadow-[0_6px_20px_rgba(0,0,0,0.25)]"
      >
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-on-accent" />
        <span className="min-w-0 truncate text-[13px] font-bold text-on-accent">
          Workout in progress · {title}
        </span>
        <span className="shrink-0 text-[13px] font-extrabold text-on-accent">→</span>
      </TransitionLink>
    </div>
  );
}

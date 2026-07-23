"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { loadGuidedSnapshot } from "@/lib/strength/guided-snapshot";
import { loadRunSnapshot } from "@/lib/run-snapshot";

type Parked = { href: string; title: string };

// Floating "get back to your workout" pill, visible on every screen with the
// tab bar while a guided session (lift OR run) is parked. Hidden on the screen
// that owns the parked session — its own resume affordance lives there. When
// both are parked, the most recently saved one wins.
export function ResumeWorkoutPill() {
  const pathname = usePathname();
  const [parked, setParked] = useState<Parked | null>(null);

  useEffect(() => {
    function check() {
      const lift = loadGuidedSnapshot();
      const run = loadRunSnapshot();
      let next: Parked | null = null;
      const liftAt = lift && !lift.finishedAt ? lift.savedAt : -1;
      const runAt = run ? run.savedAt : -1;
      if (liftAt >= 0 && liftAt >= runAt) {
        next = { href: "/strength", title: lift!.session.title };
      } else if (runAt >= 0) {
        next = { href: `/workout/${run!.workoutId}`, title: run!.title };
      }
      setParked(next);
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

  // Hide on the screen that owns the parked session.
  if (!parked || pathname === parked.href || pathname.startsWith(parked.href + "/")) {
    return null;
  }

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-40 mx-auto flex max-w-[430px] justify-center px-5"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 64px)" }}
    >
      <TransitionLink
        href={parked.href}
        className="press pointer-events-auto flex max-w-full items-center gap-2.5 rounded-full bg-accent px-4 py-2.5 shadow-[0_6px_20px_rgba(0,0,0,0.25)]"
      >
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-on-accent" />
        <span className="min-w-0 truncate text-[13px] font-bold text-on-accent">
          Workout in progress · {parked.title}
        </span>
        <span className="shrink-0 text-[13px] font-extrabold text-on-accent">→</span>
      </TransitionLink>
    </div>
  );
}

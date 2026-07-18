"use client";

// Self-contained "Weekly strength plan" card: fetches the plan settings,
// opportunistically tops up upcoming auto sessions, and links to
// /strength/setup. Shared between the Plan hub and anywhere else that wants
// the weekly-strength entry point.

import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { apiFetch } from "@/lib/api";

interface StrengthPlanSettings {
  goal: string;
  sessionsPerWeek: number;
  durationMinutes: number;
  active: boolean;
}

export function WeeklyStrengthPlan({ className = "" }: { className?: string }) {
  // undefined = loading (render nothing), null = no plan configured yet.
  const [settings, setSettings] = useState<StrengthPlanSettings | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/strength/plan-settings");
        if (!res.ok) {
          if (!cancelled) setSettings(null);
          return;
        }
        const s = await res.json();
        if (cancelled) return;
        setSettings(s);
        // Opportunistic top-up of the next two weeks of auto sessions.
        if (s?.active) apiFetch("/api/strength/plan-settings/ensure", { method: "POST" }).catch(() => {});
      } catch {
        if (!cancelled) setSettings(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (settings === undefined) return null;

  return (
    <TransitionLink href="/strength/setup" className={`press block k-card p-4 ${className}`}>
      <span className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-[20px]">🏋️</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-bold text-text-1">
            {settings ? "Weekly strength plan" : "Set up weekly strength"}
          </span>
          <span className="block text-[13px] text-text-3">
            {settings
              ? `${settings.sessionsPerWeek}×/week · ~${settings.durationMinutes} min · ${settings.goal === "running_focus" ? "Running focus" : "All-round"}${settings.active ? "" : " · paused"}`
              : "A recurring schedule built around your running"}
          </span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-text-3" strokeWidth={1.9} />
      </span>
    </TransitionLink>
  );
}

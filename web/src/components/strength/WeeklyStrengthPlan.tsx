"use client";

// Self-contained "Weekly strength plan" card: fetches the plan settings,
// opportunistically tops up upcoming auto sessions, and links to
// /strength/setup. Shared between the Plan hub and anywhere else that wants
// the weekly-strength entry point.

import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { apiFetch } from "@/lib/api";
import {
  strengthWeekCountLabel,
  strengthWeekShortfallReason,
  type StrengthPhaseInfo,
} from "@/components/strength/weekCount";

interface StrengthPlanSettings {
  goal: string;
  sessionsPerWeek: number;
  durationMinutes: number;
  active: boolean;
}

/** Monday of the calendar week containing `d`. */
function mondayOf(d: Date): Date {
  const x = new Date(d);
  const dow = x.getDay(); // 0=Sun
  x.setDate(x.getDate() + (dow === 0 ? -6 : 1 - dow));
  x.setHours(0, 0, 0, 0);
  return x;
}

export function WeeklyStrengthPlan({ className = "" }: { className?: string }) {
  // undefined = loading (render nothing), null = no plan configured yet.
  const [settings, setSettings] = useState<StrengthPlanSettings | null | undefined>(undefined);
  // Weeks in the upcoming top-up that couldn't fit the full weekly count
  // without breaking a hard rule (heavy legs on/before a hard run, race
  // blackout) — a real constraint, but it must surface here rather than be
  // discovered later as an unexplained gap in the calendar.
  const [shortWeeks, setShortWeeks] = useState(0);
  // This calendar week's actual scheduled count — the same fact Today's
  // header and the Kraft screen show, fetched once here too so this card
  // never claims the bare target as if it were reality (see weekCount.ts).
  const [thisWeekScheduled, setThisWeekScheduled] = useState<number | null>(null);
  const [phase, setPhase] = useState<StrengthPhaseInfo | null>(null);

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
        if (s?.active) {
          apiFetch("/api/strength/plan-settings/ensure", { method: "POST" })
            .then((r) => (r.ok ? r.json() : null))
            .then((body) => {
              if (!cancelled && body?.shortWeeks) setShortWeeks(body.shortWeeks);
            })
            .catch(() => {});

          const monday = mondayOf(new Date());
          const sunday = new Date(monday);
          sunday.setDate(sunday.getDate() + 7);
          apiFetch(`/api/strength/sessions?from=${monday.toISOString()}&to=${sunday.toISOString()}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((rows) => {
              if (cancelled || !Array.isArray(rows)) return;
              setThisWeekScheduled(rows.filter((r: { status: string }) => r.status !== "skipped").length);
            })
            .catch(() => {});
          apiFetch("/api/strength/summary")
            .then((r) => (r.ok ? r.json() : null))
            .then((body) => {
              if (!cancelled && body?.phase) setPhase(body.phase);
            })
            .catch(() => {});
        }
      } catch {
        if (!cancelled) setSettings(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (settings === undefined) return null;

  const target = settings?.sessionsPerWeek ?? 0;
  const shortfallReason =
    settings && thisWeekScheduled != null
      ? strengthWeekShortfallReason({
          scheduled: thisWeekScheduled,
          target,
          weekPartElapsed: new Date().getDay() !== 1, // today isn't Monday
          phase,
        })
      : null;

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
              ? `${
                  thisWeekScheduled != null && thisWeekScheduled !== target
                    ? strengthWeekCountLabel(thisWeekScheduled, target)
                    : `${target}×/week`
                } · ~${settings.durationMinutes} min · ${settings.goal === "running_focus" ? "Running focus" : "All-round"}${settings.active ? "" : " · paused"}`
              : "A recurring schedule built around your running"}
          </span>
          {settings && shortfallReason ? (
            <span className="mt-0.5 block text-[12px] text-amber-500">{shortfallReason}</span>
          ) : settings && shortWeeks > 0 ? (
            <span className="mt-0.5 block text-[12px] text-amber-500">
              {shortWeeks === 1 ? "1 upcoming week" : `${shortWeeks} upcoming weeks`} couldn&apos;t fit
              the full {target}/week without landing on a hard-run day.
            </span>
          ) : null}
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-text-3" strokeWidth={1.9} />
      </span>
    </TransitionLink>
  );
}

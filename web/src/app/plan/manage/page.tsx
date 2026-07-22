"use client";

// Manage Plan: Running (read-only plan facts + edit/remove) and Strength
// (wizard settings, tappable rows re-open /strength/setup, pause/resume).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { NavBar } from "@/components/ui/NavBar";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { predictRaceTime, RACE_DISTANCES_M } from "@/lib/plan-engine/vdot";
import { EQUIPMENT_OPTIONS } from "@/lib/strength/equipment";
import type { ApiPlanRow } from "@/lib/plan-ui";

// ── Labels ────────────────────────────────────────────────────────────────────

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const GOAL_LABEL: Record<string, string> = {
  running_focus: "Running Focus",
  all_round: "All Round Strength",
};

const ABILITY_LABEL: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

interface StrengthSettings {
  goal: "running_focus" | "all_round";
  durationMinutes: 30 | 45 | 60;
  sessionsPerWeek: number;
  ability: "beginner" | "intermediate" | "advanced";
  availableDays: number[];
  equipment: string[];
  active: boolean;
}

function equipmentLabels(keys: string[]): string {
  if (keys.length === 0) return "Bodyweight only";
  return keys
    .map((k) => EQUIPMENT_OPTIONS.find((o) => o.key === k)?.label ?? k)
    .join(", ");
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatRaceTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ss = Math.round(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
    : `${m}:${String(ss).padStart(2, "0")}`;
}

// ── Row primitives ────────────────────────────────────────────────────────────

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-input)] bg-elevated px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-3">{label}</p>
      <p className="mt-0.5 text-[15px] font-bold text-text-1">{value}</p>
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <TransitionLink
      href="/strength/setup"
      className="press flex items-center justify-between rounded-[var(--radius-input)] bg-elevated px-4 py-3"
    >
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-text-3">{label}</p>
        <p className="mt-0.5 truncate text-[15px] font-bold text-text-1">{value}</p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-text-3" strokeWidth={2} />
    </TransitionLink>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ManagePlanPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"running" | "strength">("running");
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<ApiPlanRow | null>(null);
  const [settings, setSettings] = useState<StrengthSettings | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [todayRes, settingsRes] = await Promise.all([
          apiFetch("/api/today"),
          apiFetch("/api/strength/plan-settings"),
        ]);
        if (settingsRes.ok && !cancelled) {
          const s = await settingsRes.json();
          if (s) setSettings(s as StrengthSettings);
        }
        if (todayRes.ok) {
          const today = await todayRes.json();
          if (today.activePlan && !cancelled) {
            const planRes = await apiFetch(`/api/plans/${today.planId}`);
            if (planRes.ok && !cancelled) {
              setPlan((await planRes.json()) as ApiPlanRow);
            }
          }
        }
      } catch {
        /* silent */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function removePlan() {
    if (!plan) return;
    setRemoving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/plans/${plan.id}`, { method: "DELETE" });
      if (res.ok) {
        haptic("success");
        router.push("/plan");
      } else {
        haptic("warning");
        setError("Couldn't remove the plan. Try again.");
        setRemoveOpen(false);
      }
    } catch {
      haptic("warning");
      setError("Network error — couldn't remove the plan.");
      setRemoveOpen(false);
    } finally {
      setRemoving(false);
    }
  }

  async function toggleStrengthActive() {
    if (!settings) return;
    setPausing(true);
    setError(null);
    const next = { ...settings, active: !settings.active };
    try {
      const res = await apiFetch("/api/strength/plan-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: next.goal,
          durationMinutes: next.durationMinutes,
          sessionsPerWeek: next.sessionsPerWeek,
          ability: next.ability,
          availableDays: next.availableDays,
          equipment: next.equipment,
          active: next.active,
        }),
      });
      if (res.ok) {
        haptic("success");
        setSettings(next);
      } else {
        haptic("warning");
        setError("Couldn't update the strength plan. Try again.");
      }
    } catch {
      haptic("warning");
      setError("Network error — couldn't update the strength plan.");
    } finally {
      setPausing(false);
    }
  }

  // Estimated race time: VDOT prediction when available, else the goal time.
  const raceTime = (() => {
    if (!plan) return null;
    const distanceM = RACE_DISTANCES_M[plan.raceDistance];
    if (plan.vdot && distanceM) {
      const predicted = predictRaceTime(plan.vdot, distanceM);
      return `${formatRaceTime(predicted * 0.98)} – ${formatRaceTime(predicted * 1.03)}`;
    }
    return formatRaceTime(plan.goalTimeSeconds);
  })();

  const backButton = (
    <button
      onClick={() => router.back()}
      aria-label="Back"
      className="press flex h-11 w-11 items-center justify-center rounded-lg active:bg-elevated"
    >
      <ChevronLeft className="h-5 w-5 text-text-1" strokeWidth={2.5} />
    </button>
  );

  return (
    <main className="min-h-dvh bg-bg">
      <NavBar title="Manage Plan" large={false} centerAlways left={backButton} />

      <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-8 pt-2">
        {/* Tab control — underline style */}
        <div className="relative -mx-4 flex border-b border-hairline">
          {([["running", "Running"], ["strength", "Strength"]] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => { haptic("light"); setTab(value); }}
              className={`press relative flex-1 pb-3 pt-1 text-center text-[16px] font-bold transition-colors ${
                tab === value ? "text-text-1" : "text-text-2"
              }`}
            >
              {label}
              {tab === value && (
                <span className="absolute inset-x-6 bottom-[-1px] h-[3px] rounded-full bg-text-1" />
              )}
            </button>
          ))}
        </div>

        {error && (
          <p className="rounded-[var(--radius-input)] bg-danger/10 px-3.5 py-2.5 text-[13px] font-medium text-danger">
            {error}
          </p>
        )}

        {loading ? (
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 rounded-[var(--radius-card)] bg-elevated animate-shimmer" />
            ))}
          </div>
        ) : tab === "running" ? (
          !plan ? (
            <p className="pt-2 text-[15px] text-text-2">No active plan.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <InfoCard label="Start date" value={formatDate(plan.startDate)} />
                <InfoCard label="End date" value={formatDate(plan.raceDate)} />
              </div>
              <InfoCard label="Length" value={`${plan.planLengthWeeks} weeks`} />
              {raceTime && <InfoCard label="Estimated race time" value={raceTime} />}

              <p className="mt-2 text-[11px] font-semibold uppercase tracking-widest text-text-3">
                Running schedule
              </p>
              <div className="grid grid-cols-2 gap-2">
                <InfoCard label="Runs per week" value={String(plan.daysPerWeek)} />
                <InfoCard label="Long run day" value={DOW[plan.preferredLongRunDay ?? 6]} />
              </div>

              <TransitionLink href="/plan/edit" className="block">
                <Button full variant="secondary">Edit run plan</Button>
              </TransitionLink>
              <Button
                full
                variant="danger"
                onClick={() => setRemoveOpen(true)}
              >
                Remove plan
              </Button>
            </>
          )
        ) : !settings ? (
          <div className="flex flex-col gap-3">
            <p className="pt-2 text-[15px] text-text-2">
              No strength plan yet — set one up and sessions will be scheduled
              around your runs.
            </p>
            <TransitionLink href="/strength/setup" className="block">
              <Button full>Set up strength plan</Button>
            </TransitionLink>
          </div>
        ) : (
          <>
            {!settings.active && (
              <p className="rounded-[var(--radius-input)] bg-warn/10 px-3.5 py-2.5 text-[13px] font-medium text-warn">
                Your strength plan is paused — no new sessions are scheduled.
              </p>
            )}
            <SettingRow label="Ability" value={ABILITY_LABEL[settings.ability] ?? settings.ability} />
            <SettingRow label="Goal" value={GOAL_LABEL[settings.goal] ?? settings.goal} />
            <SettingRow label="Equipment" value={equipmentLabels(settings.equipment)} />
            <SettingRow label="Sessions per week" value={String(settings.sessionsPerWeek)} />
            <SettingRow
              label="Available days"
              value={[1, 2, 3, 4, 5, 6, 0]
                .filter((d) => settings.availableDays.includes(d))
                .map((d) => DOW_SHORT[d])
                .join(", ")}
            />
            <SettingRow label="Session length" value={`${settings.durationMinutes} minutes`} />

            <Button
              full
              variant={settings.active ? "danger" : "primary"}
              busy={pausing}
              onClick={toggleStrengthActive}
            >
              {settings.active ? "Pause strength plan" : "Resume strength plan"}
            </Button>
          </>
        )}
      </div>

      {/* Remove-plan confirmation */}
      <Sheet open={removeOpen} onClose={() => setRemoveOpen(false)} title="Remove plan?">
        <div className="flex flex-col gap-4 px-1 pb-2">
          <p className="text-[14px] leading-relaxed text-text-2">
            Your plan will be archived and removed from Today, Plan and Stats.
            Completed runs stay in your history. You can create a new plan any
            time.
          </p>
          <Button full variant="danger" busy={removing} onClick={removePlan}>
            Remove plan
          </Button>
          <button
            onClick={() => setRemoveOpen(false)}
            className="press mx-auto text-[13px] font-medium text-text-3"
          >
            Cancel
          </button>
        </div>
      </Sheet>
    </main>
  );
}

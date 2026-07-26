"use client";

// Manage Plan: a tabbed page (Running, Strength functional; Yoga / Pilates /
// Stretch & Stability as coming-soon setup shells). Card-row selectors re-open
// the relevant editor; Running has Start-new / Edit / Remove.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Share2, Pencil, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { KadenzMark } from "@/components/ui/KadenzMark";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { predictRaceTime, RACE_DISTANCES_M } from "@/lib/plan-engine/vdot";
import { EQUIPMENT_OPTIONS } from "@/lib/strength/equipment";
import type { ApiPlanRow } from "@/lib/plan-ui";

// ── Labels ────────────────────────────────────────────────────────────────────

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const RACE_LABEL: Record<string, string> = {
  "5k": "5K", "10k": "10K", half: "Half Marathon", marathon: "Marathon", ultra: "Ultra (50K)", custom: "Custom",
};
const GOAL_LABEL: Record<string, string> = {
  running_focus: "Running Focus",
  all_round: "All Round Strength",
};
const ABILITY_LABEL: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

interface SkipWeekEligibility {
  weekId: string;
  weekNumber: number;
  phase: "base" | "build" | "peak" | "taper";
  startDate: string;
  endDate: string;
  hasCompletedWorkouts: boolean;
}

interface SkipWeekOptions {
  eligible: SkipWeekEligibility[];
  suggestedWeekId: string | null;
  blockedReason: string | null;
}

type SkipReason = "illness" | "travel" | "injury" | "other";
const SKIP_REASONS: { key: SkipReason; label: string }[] = [
  { key: "illness", label: "Illness" },
  { key: "travel", label: "Travel" },
  { key: "injury", label: "Injury" },
  { key: "other", label: "Other" },
];

type Tab = "running" | "strength" | "yoga" | "pilates" | "stretch";
const TABS: { key: Tab; label: string }[] = [
  { key: "running", label: "Running" },
  { key: "strength", label: "Strength" },
  { key: "yoga", label: "Yoga" },
  { key: "pilates", label: "Pilates" },
  { key: "stretch", label: "Stretch & Stability" },
];

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
  return keys.map((k) => EQUIPMENT_OPTIONS.find((o) => o.key === k)?.label ?? k).join(", ");
}

function daysLabel(days: number[]): string {
  return [1, 2, 3, 4, 5, 6, 0].filter((d) => days.includes(d)).map((d) => DOW_SHORT[d]).join(", ");
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
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

const ROW_CLS =
  "press flex items-center justify-between rounded-2xl bg-surface px-4 py-3.5 [box-shadow:var(--k-ring-hairline),var(--k-shadow-card)]";

function SelectRow({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <TransitionLink href={href} className={ROW_CLS}>
      <div className="min-w-0">
        <p className="text-[13px] text-text-3">{label}</p>
        <p className="mt-0.5 truncate text-[16px] font-semibold text-text-1">{value}</p>
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-text-3" strokeWidth={2} />
    </TransitionLink>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-3 text-[18px] font-extrabold tracking-tight text-text-1">{children}</h2>;
}

function SetupShell({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="rounded-2xl bg-elevated p-4">
      <p className="text-[16px] font-bold text-text-1">Set up {title}</p>
      <p className="mt-1 text-[13px] leading-snug text-text-2">{blurb}</p>
      <span className="mt-3 inline-flex items-center rounded-full bg-surface px-3 py-1.5 text-[12px] font-semibold text-text-3">
        Coming soon
      </span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ManagePlanPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("running");
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<ApiPlanRow | null>(null);
  const [settings, setSettings] = useState<StrengthSettings | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeStrengthOpen, setRemoveStrengthOpen] = useState(false);
  const [removingStrength, setRemovingStrength] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Skip a week ─────────────────────────────────────────────────────────────
  const [skipOpen, setSkipOpen] = useState(false);
  const [skipLoading, setSkipLoading] = useState(false);
  const [skipOptions, setSkipOptions] = useState<SkipWeekOptions | null>(null);
  const [skipSelectedId, setSkipSelectedId] = useState<string | null>(null);
  const [skipReason, setSkipReason] = useState<SkipReason | null>(null);
  const [skipping, setSkipping] = useState(false);
  const [undoingWeekId, setUndoingWeekId] = useState<string | null>(null);

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
            if (planRes.ok && !cancelled) setPlan((await planRes.json()) as ApiPlanRow);
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

  async function refetchPlan(planId: string) {
    const res = await apiFetch(`/api/plans/${planId}`);
    if (res.ok) setPlan((await res.json()) as ApiPlanRow);
  }

  async function openSkipWeek() {
    if (!plan) return;
    setSkipOpen(true);
    setSkipLoading(true);
    setSkipOptions(null);
    setSkipSelectedId(null);
    setSkipReason(null);
    try {
      const res = await apiFetch(`/api/plans/${plan.id}/skip-week`);
      if (res.ok) {
        const data = (await res.json()) as SkipWeekOptions;
        setSkipOptions(data);
        setSkipSelectedId(data.suggestedWeekId);
      } else {
        setSkipOptions({ eligible: [], suggestedWeekId: null, blockedReason: "Couldn't check your plan. Try again." });
      }
    } catch {
      setSkipOptions({ eligible: [], suggestedWeekId: null, blockedReason: "Network error, couldn't check your plan." });
    } finally {
      setSkipLoading(false);
    }
  }

  async function confirmSkipWeek() {
    if (!plan || !skipSelectedId) return;
    setSkipping(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/plans/${plan.id}/skip-week`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekId: skipSelectedId, reason: skipReason ?? undefined }),
      });
      if (res.ok) {
        haptic("success");
        setSkipOpen(false);
        await refetchPlan(plan.id);
      } else {
        const body = await res.json().catch(() => null);
        haptic("warning");
        setError(body?.error ?? "Couldn't skip that week. Try again.");
        setSkipOpen(false);
      }
    } catch {
      haptic("warning");
      setError("Network error, couldn't skip that week.");
      setSkipOpen(false);
    } finally {
      setSkipping(false);
    }
  }

  async function undoSkipWeek(weekId: string) {
    if (!plan) return;
    setUndoingWeekId(weekId);
    setError(null);
    try {
      const res = await apiFetch(`/api/plans/${plan.id}/skip-week/undo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekId }),
      });
      if (res.ok) {
        haptic("success");
        await refetchPlan(plan.id);
      } else {
        haptic("warning");
        setError("Couldn't undo that skip. Try again.");
      }
    } catch {
      haptic("warning");
      setError("Network error, couldn't undo that skip.");
    } finally {
      setUndoingWeekId(null);
    }
  }

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
      setError("Network error, couldn't remove the plan.");
      setRemoveOpen(false);
    } finally {
      setRemoving(false);
    }
  }

  async function removeStrengthPlan() {
    setRemovingStrength(true);
    setError(null);
    try {
      const res = await apiFetch("/api/strength/plan-settings", { method: "DELETE" });
      if (res.ok) {
        haptic("success");
        router.push("/plan");
      } else {
        haptic("warning");
        setError("Couldn't remove the strength plan. Try again.");
        setRemoveStrengthOpen(false);
      }
    } catch {
      haptic("warning");
      setError("Network error, couldn't remove the strength plan.");
      setRemoveStrengthOpen(false);
    } finally {
      setRemovingStrength(false);
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
      setError("Network error, couldn't update the strength plan.");
    } finally {
      setPausing(false);
    }
  }

  function sharePlan() {
    if (!plan) return;
    const text = `${plan.name} — ends ${formatDate(plan.raceDate)}`;
    const nav = navigator as unknown as { share?: (d: { title: string; text: string }) => Promise<void> };
    if (nav.share) nav.share({ title: plan.name, text }).catch(() => {});
    else haptic("light");
  }

  // Estimated race time (race intents only).
  const raceTime = (() => {
    if (!plan || (plan.intent && plan.intent !== "race")) return null;
    const distanceM = RACE_DISTANCES_M[plan.raceDistance];
    if (plan.vdot && distanceM) {
      const predicted = predictRaceTime(plan.vdot, distanceM);
      return `${formatRaceTime(predicted * 0.98)} – ${formatRaceTime(predicted * 1.03)}`;
    }
    return formatRaceTime(plan.goalTimeSeconds);
  })();

  return (
    <main className="min-h-dvh bg-bg">
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 pb-1"
        style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
      >
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="press flex h-11 w-11 items-center justify-center rounded-lg active:bg-elevated"
        >
          <ChevronLeft className="h-5 w-5 text-text-1" strokeWidth={2.5} />
        </button>
        <button
          onClick={sharePlan}
          aria-label="Share plan"
          className="press flex h-11 w-11 items-center justify-center rounded-lg active:bg-elevated"
        >
          <Share2 className="h-5 w-5 text-text-1" strokeWidth={2} />
        </button>
      </div>

      <div className="mx-auto flex w-full max-w-md flex-col px-4 pb-10">
        {/* Hero */}
        <div className="flex items-center gap-3 pb-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-on-accent" style={{ background: "var(--k-signature-grad)" }}>
            <KadenzMark className="h-7 w-7" />
          </div>
          <div className="min-w-0">
            <TransitionLink href="/plan/edit" className="press flex items-center gap-2">
              <h1 className="truncate text-[22px] font-extrabold tracking-tight text-text-1">
                {plan?.name ?? "Your Plan"}
              </h1>
              <Pencil className="h-4 w-4 shrink-0 text-text-3" strokeWidth={2} />
            </TransitionLink>
            {plan && <p className="mt-0.5 text-[13px] text-text-2">End date: {formatDate(plan.raceDate)}</p>}
          </div>
        </div>

        {/* Tabs (scrollable, underline) */}
        <div className="-mx-4 mb-4 overflow-x-auto border-b border-hairline px-4">
          <div className="flex min-w-max gap-6">
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => { haptic("light"); setTab(key); }}
                className={`press relative shrink-0 whitespace-nowrap pb-3 pt-1 text-[16px] font-bold transition-colors ${
                  tab === key ? "text-text-1" : "text-text-2"
                }`}
              >
                {label}
                {tab === key && <span className="absolute inset-x-0 bottom-[-1px] h-[3px] rounded-full bg-text-1" />}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="mb-3 rounded-[var(--radius-input)] bg-danger/10 px-3.5 py-2.5 text-[13px] font-medium text-danger">
            {error}
          </p>
        )}

        {loading ? (
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 rounded-2xl bg-elevated animate-shimmer" />
            ))}
          </div>
        ) : tab === "running" ? (
          !plan ? (
            <div className="flex flex-col gap-3">
              <p className="pt-2 text-[15px] text-text-2">No active running plan yet.</p>
              <TransitionLink href="/create" className="block"><Button full>Start a new plan</Button></TransitionLink>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {raceTime && <SelectRow label="Estimated race time" value={`${raceTime} · ${RACE_LABEL[plan.raceDistance] ?? plan.raceDistance}`} href="/plan/edit" />}
              <SectionHeader>Running schedule</SectionHeader>
              <SelectRow label="Runs per week" value={String(plan.daysPerWeek)} href="/plan/edit" />
              <SelectRow label="Available" value={daysLabel(plan.availableDays ?? []) || "Flexible"} href="/plan/edit" />
              <SelectRow label="Long run day" value={DOW[plan.preferredLongRunDay ?? 6]} href="/plan/edit" />
              <SelectRow label="Units of measure" value="Set in Settings" href="/settings/units" />

              {plan.weeks.some((w) => w.skippedAt) && (
                <>
                  <SectionHeader>Skipped weeks</SectionHeader>
                  {plan.weeks
                    .filter((w) => w.skippedAt)
                    .map((w) => (
                      <div
                        key={w.id}
                        className="flex items-center justify-between rounded-2xl bg-elevated px-4 py-3.5"
                      >
                        <div className="min-w-0">
                          <p className="text-[15px] font-semibold text-text-1">
                            Week {w.weekNumber}
                            {w.skipReason ? ` · ${w.skipReason}` : ""}
                          </p>
                          <p className="mt-0.5 text-[12.5px] text-text-2">
                            No training scheduled this week, later weeks are unchanged.
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="secondary"
                          busy={undoingWeekId === w.id}
                          onClick={() => undoSkipWeek(w.id)}
                        >
                          Undo
                        </Button>
                      </div>
                    ))}
                </>
              )}

              <div className="mt-4 flex flex-col gap-2.5">
                <TransitionLink href="/create" className="block"><Button full>Start a new plan</Button></TransitionLink>
                <TransitionLink href="/plan/edit" className="block"><Button full variant="secondary">Edit this plan</Button></TransitionLink>
                <Button full variant="secondary" onClick={openSkipWeek}>Skip a week</Button>
                <Button full variant="danger" onClick={() => setRemoveOpen(true)}>Remove plan</Button>
              </div>
            </div>
          )
        ) : tab === "strength" ? (
          !settings ? (
            <div className="flex flex-col gap-3">
              <SetupShell title="strength" blurb="Add guided strength sessions, scheduled around your runs." />
              <TransitionLink href="/strength/setup" className="block"><Button full>Set up strength plan</Button></TransitionLink>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {!settings.active && (
                <p className="rounded-[var(--radius-input)] bg-warn/10 px-3.5 py-2.5 text-[13px] font-medium text-warn">
                  Your strength plan is paused, no new sessions are scheduled.
                </p>
              )}
              <SelectRow label="Strength ability" value={ABILITY_LABEL[settings.ability] ?? settings.ability} href="/strength/setup" />
              <SelectRow label="Strength goal" value={GOAL_LABEL[settings.goal] ?? settings.goal} href="/strength/setup" />
              <SelectRow label="Equipment" value={equipmentLabels(settings.equipment)} href="/strength/setup" />
              <SectionHeader>Strength schedule</SectionHeader>
              <SelectRow label="Sessions per week" value={String(settings.sessionsPerWeek)} href="/strength/setup" />
              <SelectRow label="Available" value={daysLabel(settings.availableDays)} href="/strength/setup" />
              <SelectRow label="Session length" value={`${settings.durationMinutes} minutes`} href="/settings/kraft" />

              <div className="mt-4 flex flex-col gap-2.5">
                <TransitionLink href="/strength/setup" className="block">
                  <Button full variant="secondary">Start new strength plan</Button>
                </TransitionLink>
                <Button full variant="secondary" busy={pausing} onClick={toggleStrengthActive}>
                  {settings.active ? "Pause strength plan" : "Resume strength plan"}
                </Button>
                <Button full variant="danger" onClick={() => setRemoveStrengthOpen(true)}>
                  Remove strength plan
                </Button>
              </div>
            </div>
          )
        ) : (
          <SetupShell
            title={tab === "yoga" ? "yoga" : tab === "pilates" ? "Pilates" : "stretch & stability"}
            blurb={
              tab === "yoga"
                ? "Add guided yoga to build mobility and recovery alongside your running."
                : tab === "pilates"
                ? "Improve balance and core stability with guided Pilates tailored to runners."
                : "Add short stretch & stability routines to keep you resilient between sessions."
            }
          />
        )}
      </div>

      {/* Remove-plan confirmation */}
      <Sheet open={removeOpen} onClose={() => setRemoveOpen(false)} title="Remove plan?">
        <div className="flex flex-col gap-4 px-1 pb-2">
          <p className="text-[14px] leading-relaxed text-text-2">
            Your plan will be archived and removed from Today, Plan and Stats.
            Completed runs stay in your history. You can start a new plan any time.
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

      {/* Remove-strength-plan confirmation */}
      <Sheet
        open={removeStrengthOpen}
        onClose={() => setRemoveStrengthOpen(false)}
        title="Remove strength plan?"
      >
        <div className="flex flex-col gap-4 px-1 pb-2">
          <p className="text-[14px] leading-relaxed text-text-2">
            Upcoming strength sessions will be removed, along with their calendar
            events and watch workouts. Sessions you have already completed stay in
            your history, so your logged weights and progression are kept.
          </p>
          <Button full variant="danger" busy={removingStrength} onClick={removeStrengthPlan}>
            Remove strength plan
          </Button>
          <button
            onClick={() => setRemoveStrengthOpen(false)}
            className="press mx-auto text-[13px] font-medium text-text-3"
          >
            Cancel
          </button>
        </div>
      </Sheet>

      {/* Skip a week */}
      <Sheet open={skipOpen} onClose={() => setSkipOpen(false)} title="Skip a week">
        <div className="flex flex-col gap-4 px-1 pb-2">
          {skipLoading ? (
            <div className="flex flex-col gap-2.5">
              {[0, 1].map((i) => (
                <div key={i} className="h-16 rounded-2xl bg-elevated animate-shimmer" />
              ))}
            </div>
          ) : skipOptions?.blockedReason ? (
            <>
              <p className="text-[14px] leading-relaxed text-text-2">{skipOptions.blockedReason}</p>
              <button
                onClick={() => setSkipOpen(false)}
                className="press mx-auto text-[13px] font-medium text-text-3"
              >
                Close
              </button>
            </>
          ) : (
            <>
              <p className="text-[14px] leading-relaxed text-text-2">
                Life happens. Drop a base or build week and the rest of your plan
                stays put, your race day does not move. Any workouts you have
                already logged that week stay in your history.
              </p>

              <div className="flex flex-col gap-2">
                {skipOptions?.eligible.map((w) => {
                  const selected = w.weekId === skipSelectedId;
                  return (
                    <button
                      key={w.weekId}
                      onClick={() => { haptic("light"); setSkipSelectedId(w.weekId); }}
                      className={`press flex items-center justify-between rounded-2xl px-4 py-3 text-left ${
                        selected ? "bg-elevated ring-2 ring-text-1" : "bg-surface [box-shadow:var(--k-ring-hairline)]"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-[15px] font-semibold text-text-1">Week {w.weekNumber}</p>
                        <p className="text-[12.5px] text-text-2">
                          {formatDate(w.startDate)} to {formatDate(w.endDate)}
                          {w.hasCompletedWorkouts ? " · has logged workouts" : ""}
                        </p>
                      </div>
                      {selected && <Check className="h-5 w-5 shrink-0 text-text-1" strokeWidth={2.5} />}
                    </button>
                  );
                })}
              </div>

              <div>
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-text-3">
                  Reason (optional)
                </p>
                <div className="flex flex-wrap gap-2">
                  {SKIP_REASONS.map((r) => (
                    <button
                      key={r.key}
                      onClick={() => { haptic("light"); setSkipReason(skipReason === r.key ? null : r.key); }}
                      className={`press rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${
                        skipReason === r.key
                          ? "bg-text-1 text-bg"
                          : "bg-elevated text-text-2"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              <Button
                full
                variant="danger"
                busy={skipping}
                disabled={!skipSelectedId}
                onClick={confirmSkipWeek}
              >
                Skip this week
              </Button>
              <button
                onClick={() => setSkipOpen(false)}
                className="press mx-auto text-[13px] font-medium text-text-3"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </Sheet>
    </main>
  );
}

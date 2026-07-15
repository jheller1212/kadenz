"use client";

// Plan Overview: one week at a time, every run + strength session as a
// full-width card in date order, each with a tickable completion checkbox.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { NavBar } from "@/components/ui/NavBar";
import { Sheet } from "@/components/ui/Sheet";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import {
  runSpine,
  STRENGTH_SPINE,
  type ApiPlanRow,
  type ApiWorkoutRow,
  type StrengthSessionRow,
  mondayOf,
  addDays,
  durationWindow,
} from "@/lib/plan-ui";

type Item =
  | { kind: "run"; id: string; workout: ApiWorkoutRow }
  | { kind: "strength"; id: string; session: StrengthSessionRow };

function itemDate(item: Item): Date {
  return new Date(item.kind === "run" ? item.workout.date : item.session.date);
}

function itemStatus(item: Item): string {
  return item.kind === "run" ? item.workout.status : item.session.status;
}

function dateLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "short" });
}

// ── Workout card (Today-card style: gradient spine + checkbox) ────────────────

function OverviewCard({
  item,
  onToggle,
  busy,
}: {
  item: Item;
  onToggle: (item: Item) => void;
  busy: boolean;
}) {
  const completed = itemStatus(item) === "completed";
  const spine = item.kind === "run" ? runSpine(item.workout.type) : STRENGTH_SPINE;
  const title = item.kind === "run" ? item.workout.title : item.session.title;
  const typeLabel =
    item.kind === "run"
      ? item.workout.type.charAt(0).toUpperCase() + item.workout.type.slice(1)
      : "Strength";
  const spec =
    item.kind === "run"
      ? item.workout.targetKm != null
        ? `${item.workout.targetKm}km`
        : item.workout.targetDurationMinutes != null
        ? `${item.workout.targetDurationMinutes}m`
        : null
      : item.session.targetDurationMinutes != null
      ? durationWindow(item.session.targetDurationMinutes)
      : null;
  const href =
    item.kind === "run" ? `/workout/${item.id}` : `/strength/session/${item.id}`;

  return (
    <div className="k-card relative flex items-stretch overflow-hidden">
      <div className="w-1.5 shrink-0" style={{ backgroundImage: spine }} />

      <TransitionLink href={href} className="press min-w-0 flex-1 px-4 py-3.5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-text-3">
          {typeLabel}
        </p>
        <p className="mt-0.5 text-[15px] font-bold leading-tight text-text-1 truncate">
          {title}
        </p>
        <p className="mt-0.5 text-[12.5px] text-text-3">
          {dateLabel(itemDate(item))}
          {spec && ` · ${spec}`}
        </p>
      </TransitionLink>

      {/* Tickable rounded-square checkbox */}
      <button
        type="button"
        disabled={busy}
        onClick={() => onToggle(item)}
        aria-label={completed ? "Mark as planned" : "Mark as completed"}
        className="press flex items-start px-3.5 pt-3.5 disabled:opacity-40"
      >
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-lg border-2 transition-colors ${
            completed
              ? "border-transparent bg-accent text-on-accent"
              : "border-hairline bg-transparent text-transparent"
          }`}
        >
          <Check className="h-4 w-4" strokeWidth={3} />
        </span>
      </button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PlanOverviewPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<ApiPlanRow | null>(null);
  const [sessions, setSessions] = useState<StrengthSessionRow[]>([]);
  const [weekNum, setWeekNum] = useState(1);
  const [weekSheetOpen, setWeekSheetOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const todayRes = await apiFetch("/api/today");
        if (!todayRes.ok) return;
        const today = await todayRes.json();
        if (!today.activePlan || cancelled) return;

        const planRes = await apiFetch(`/api/plans/${today.planId}`);
        if (!planRes.ok || cancelled) return;
        const p = (await planRes.json()) as ApiPlanRow;
        setPlan(p);
        if (today.currentWeek) setWeekNum(today.currentWeek);

        const firstDate = p.weeks[0]?.workouts[0]?.date;
        if (firstDate) {
          const from = mondayOf(new Date(firstDate));
          const to = addDays(mondayOf(new Date(p.raceDate)), 6);
          to.setHours(23, 59, 59, 999);
          const sRes = await apiFetch(
            `/api/strength/sessions?from=${from.toISOString()}&to=${to.toISOString()}`
          );
          if (sRes.ok && !cancelled) {
            setSessions((await sRes.json()) as StrengthSessionRow[]);
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

  const totalWeeks = plan?.weeks.length ?? 0;

  const items: Item[] = useMemo(() => {
    if (!plan) return [];
    const week = plan.weeks.find((w) => w.weekNumber === weekNum);
    const first = week?.workouts[0]?.date;
    if (!week || !first) return [];
    const monday = mondayOf(new Date(first));
    const end = addDays(monday, 7);

    const runs: Item[] = week.workouts
      .filter((w) => w.type !== "rest")
      .map((w) => ({ kind: "run", id: w.id, workout: w }));
    const strength: Item[] = sessions
      .filter((s) => {
        const d = new Date(s.date);
        return d >= monday && d < end;
      })
      .map((s) => ({ kind: "strength", id: s.id, session: s }));

    return [...runs, ...strength].sort(
      (a, b) => itemDate(a).getTime() - itemDate(b).getTime()
    );
  }, [plan, sessions, weekNum]);

  // ── Complete / untick ───────────────────────────────────────────────────────

  const toggle = useCallback(
    async (item: Item) => {
      if (!plan) return;
      const completed = itemStatus(item) === "completed";
      const nextStatus = completed ? "planned" : "completed";
      haptic(completed ? "light" : "success");
      setBusyId(item.id);

      // Optimistic update.
      const applyRun = (status: string) =>
        setPlan((prev) =>
          prev
            ? {
                ...prev,
                weeks: prev.weeks.map((wk) => ({
                  ...wk,
                  workouts: wk.workouts.map((w) =>
                    w.id === item.id ? { ...w, status } : w
                  ),
                })),
              }
            : prev
        );
      const applyStrength = (status: string) =>
        setSessions((prev) =>
          prev.map((s) => (s.id === item.id ? { ...s, status } : s))
        );

      if (item.kind === "run") applyRun(nextStatus);
      else applyStrength(nextStatus);

      try {
        let res: Response;
        if (item.kind === "run") {
          res = completed
            ? await apiFetch(`/api/plans/${plan.id}/workouts/${item.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "planned" }),
              })
            : await apiFetch(`/api/workouts/${item.id}/complete`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
              });
        } else {
          res = await apiFetch(`/api/strength/sessions/${item.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: nextStatus }),
          });
        }
        if (!res.ok) throw new Error("toggle failed");
      } catch {
        // Revert on failure.
        haptic("warning");
        if (item.kind === "run") applyRun(item.workout.status);
        else applyStrength(item.session.status);
      } finally {
        setBusyId(null);
      }
    },
    [plan]
  );

  const backButton = (
    <button
      onClick={() => router.back()}
      aria-label="Back"
      className="press flex h-11 w-11 items-center justify-center rounded-lg active:bg-elevated"
    >
      <ChevronLeft className="h-5 w-5 text-text-1" strokeWidth={2.5} />
    </button>
  );

  if (loading) {
    return (
      <main className="min-h-dvh bg-bg">
        <NavBar title="Plan Overview" large={false} centerAlways left={backButton} />
        <div className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 pt-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-[var(--radius-card)] bg-elevated animate-shimmer" />
          ))}
        </div>
      </main>
    );
  }

  if (!plan) {
    return (
      <main className="min-h-dvh bg-bg">
        <NavBar title="Plan Overview" large={false} centerAlways left={backButton} />
        <p className="px-4 pt-2 text-[15px] text-text-2">No active plan.</p>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-bg">
      <NavBar title="Plan Overview" large={false} centerAlways left={backButton} />

      <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-8 pt-2">
        {/* Week switcher */}
        <header className="flex items-center justify-between">
          <button
            onClick={() => {
              haptic("light");
              setWeekNum((n) => Math.max(1, n - 1));
            }}
            disabled={weekNum <= 1}
            className="press flex h-9 w-9 items-center justify-center rounded-full bg-elevated disabled:opacity-30"
            aria-label="Previous week"
          >
            <ChevronLeft className="h-4 w-4 text-text-2" strokeWidth={2} />
          </button>

          <button
            onClick={() => {
              haptic("light");
              setWeekSheetOpen(true);
            }}
            className="press flex items-center gap-1.5"
          >
            <span className="text-[17px] font-bold text-text-1">Week {weekNum}</span>
            <ChevronDown className="h-3.5 w-3.5 text-text-3" strokeWidth={2.5} />
          </button>

          <button
            onClick={() => {
              haptic("light");
              setWeekNum((n) => Math.min(totalWeeks, n + 1));
            }}
            disabled={weekNum >= totalWeeks}
            className="press flex h-9 w-9 items-center justify-center rounded-full bg-elevated disabled:opacity-30"
            aria-label="Next week"
          >
            <ChevronRight className="h-4 w-4 text-text-2" strokeWidth={2} />
          </button>
        </header>

        {/* Workout cards in date order */}
        {items.length === 0 ? (
          <p className="pt-4 text-center text-[13px] text-text-3">
            No workouts scheduled this week.
          </p>
        ) : (
          items.map((item) => (
            <OverviewCard
              key={`${item.kind}:${item.id}`}
              item={item}
              onToggle={toggle}
              busy={busyId === item.id}
            />
          ))
        )}
      </div>

      {/* Week picker sheet */}
      <Sheet open={weekSheetOpen} onClose={() => setWeekSheetOpen(false)} title="Select week">
        <div className="pb-4">
          {plan.weeks.map((week) => {
            const selected = week.weekNumber === weekNum;
            return (
              <button
                key={week.weekNumber}
                onClick={() => {
                  haptic("light");
                  setWeekNum(week.weekNumber);
                  setWeekSheetOpen(false);
                }}
                className={`press flex w-full items-center justify-between rounded-[var(--radius-input)] px-3 py-3 text-left ${
                  selected ? "bg-accent/10" : "active:bg-elevated"
                }`}
              >
                <span className={`text-[15px] font-bold ${selected ? "text-accent" : "text-text-1"}`}>
                  Week {week.weekNumber}
                </span>
                <span className="text-[11px] text-text-3 tabular-nums">
                  {Math.round(week.targetKm)} km
                </span>
              </button>
            );
          })}
        </div>
      </Sheet>
    </main>
  );
}

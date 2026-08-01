"use client";

// Plan Overview: one week at a time, every run + strength session as a
// full-width card in date order, each with a tickable completion checkbox.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Moon,
  SlidersHorizontal,
} from "lucide-react";
import { NavBar } from "@/components/ui/NavBar";
import { Sheet } from "@/components/ui/Sheet";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { apiFetch } from "@/lib/api";
import { displayDistance, distanceUnitLabel } from "@/lib/units";
import { workoutUrl, strengthSessionUrl } from "@/lib/routes";
import { haptic } from "@/lib/haptics";
import {
  runSpine,
  STRENGTH_SPINE,
  STRENGTH_BLUE,
  phaseSummary,
  type ApiPlanRow,
  type ApiWorkoutRow,
  type StrengthSessionRow,
  type WeekPhase,
  mondayOf,
  addDays,
  sameDay,
  durationWindow,
} from "@/lib/plan-ui";

const PHASE_LABEL: Record<WeekPhase, string> = {
  base: "Base",
  build: "Build",
  peak: "Peak",
  taper: "Taper",
};

const RACE_LABEL: Record<string, string> = {
  "5k": "5K",
  "10k": "10K",
  half: "Half marathon",
  marathon: "Marathon",
  ultra: "Ultra",
  custom: "Custom distance",
};

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

const DAY_LETTERS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

// ── Day row: fixed date column + colored spine pill + title/subtitle ──────────
// Matches the Volt "Plan · week" day-row shape. Rest days render inline too
// (no spine, muted) so the week reads as a full 7-day schedule, not just the
// days with something scheduled.

function DayRow({
  date,
  item,
  isToday,
  onToggle,
  busy,
}: {
  date: Date;
  item: Item | null;
  isToday: boolean;
  onToggle: (item: Item) => void;
  busy: boolean;
}) {
  const completed = item ? itemStatus(item) === "completed" : false;
  const spine = !item
    ? "var(--k-hairline)"
    : item.kind === "run"
    ? runSpine(item.workout.type)
    : STRENGTH_SPINE;
  const spineIsGradient = spine.startsWith("linear-gradient");
  const title = item ? (item.kind === "run" ? item.workout.title : item.session.title) : "Rest";
  const spec = !item
    ? "Recovery is part of the plan."
    : item.kind === "run"
    ? item.workout.targetKm != null
      ? `${displayDistance(item.workout.targetKm)}${distanceUnitLabel()}`
      : item.workout.targetDurationMinutes != null
      ? `${item.workout.targetDurationMinutes}m`
      : dateLabel(itemDate(item))
    : item.session.targetDurationMinutes != null
    ? durationWindow(item.session.targetDurationMinutes)
    : dateLabel(itemDate(item));
  const href = item
    ? item.kind === "run"
      ? workoutUrl(item.id)
      : strengthSessionUrl(item.id)
    : null;
  const stateColor = item
    ? item.kind === "run"
      ? runSpine(item.workout.type)
      : STRENGTH_BLUE
    : undefined;

  const rowClass = `flex items-center gap-3 rounded-2xl px-[15px] py-[13px] ${
    isToday
      ? "bg-accent/10 [box-shadow:inset_0_0_0_1.5px_rgba(200,255,61,0.5)]"
      : "k-card"
  } ${!item ? "opacity-75" : ""}`;

  const dateCol = (
    <div className="w-9 shrink-0 text-center">
      <p className={`text-[9px] font-bold ${isToday ? "text-accent-fg" : "text-text-3"}`}>
        {DAY_LETTERS[(date.getDay() + 6) % 7]}
      </p>
      <p className={`font-display text-[17px] leading-none ${isToday ? "text-accent-fg" : "text-text-1"}`}>
        {date.getDate()}
      </p>
    </div>
  );

  const spinePill = (
    <div
      className="h-9 w-1 shrink-0 rounded-full"
      style={spineIsGradient ? { backgroundImage: spine } : { backgroundColor: spine }}
    />
  );

  const textCol = (
    <div className="min-w-0 flex-1">
      <p className="truncate text-[15px] font-bold text-text-1">{title}</p>
      <p className="truncate text-xs text-text-3">{spec}</p>
    </div>
  );

  // Not a link when there's nothing to open (rest day).
  if (!href || !item) {
    return (
      <div className={rowClass}>
        {dateCol}
        {spinePill}
        {textCol}
        <Moon className="h-[18px] w-[18px] shrink-0 text-text-3" strokeWidth={1.5} />
      </div>
    );
  }

  return (
    <div className={rowClass}>
      <TransitionLink href={href} className="press flex min-w-0 flex-1 items-center gap-3">
        {dateCol}
        {spinePill}
        {textCol}
      </TransitionLink>
      <button
        type="button"
        disabled={busy}
        onClick={() => onToggle(item)}
        aria-label={completed ? "Mark as planned" : "Mark as completed"}
        className="press shrink-0 disabled:opacity-40"
      >
        <CheckCircle2
          className="h-[19px] w-[19px]"
          strokeWidth={2}
          style={{ color: completed ? stateColor : "var(--k-text-3)" }}
          fill={completed ? "currentColor" : "none"}
        />
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
        // Was /api/today -> /api/plans/[id] -> /api/strength/sessions, three
        // serial round trips purely to learn the active plan's id and then
        // its own date range. One call now — see api/plans/active/route.ts.
        const res = await apiFetch("/api/plans/active?sessions=1");
        if (!res.ok || cancelled) return;
        const bundle = await res.json();
        if (!bundle.activePlan || !bundle.plan || cancelled) return;
        const p = bundle.plan as ApiPlanRow;
        setPlan(p);
        if (bundle.strengthSessions) {
          setSessions(bundle.strengthSessions as StrengthSessionRow[]);
        }

        // The week containing "now" — /api/today used to hand this over
        // ready-made; derived here the same way plan/page.tsx's hub already
        // does, from the plan we just got, rather than a second server round
        // trip for one number.
        const now = new Date();
        const current = p.weeks.find((w) => {
          const first = w.workouts[0]?.date;
          if (!first) return false;
          const monday = mondayOf(new Date(first));
          return monday <= now && now < addDays(monday, 7);
        });
        if (current) setWeekNum(current.weekNumber);
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

  // One row per calendar day (Mon-Sun), the run taking priority over a
  // same-day strength session when both exist — mirrors Today's day cell.
  // Strength gets its own row only when there's no run that day.
  const dayRows = useMemo(() => {
    if (!plan) return [];
    const week = plan.weeks.find((w) => w.weekNumber === weekNum);
    const first = week?.workouts[0]?.date;
    if (!week || !first) return [];
    const monday = mondayOf(new Date(first));
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(monday, i);
      const run = items.find((it) => it.kind === "run" && sameDay(itemDate(it), date));
      const strength = items.find((it) => it.kind === "strength" && sameDay(itemDate(it), date));
      return { date, item: run ?? strength ?? null };
    });
  }, [plan, weekNum, items]);

  const weekKm = useMemo(() => {
    const week = plan?.weeks.find((w) => w.weekNumber === weekNum);
    return week?.targetKm ?? 0;
  }, [plan, weekNum]);

  const raceDateObj = plan ? new Date(plan.raceDate) : null;
  const now = new Date();
  const daysToRace = raceDateObj
    ? Math.max(0, Math.round((raceDateObj.getTime() - now.getTime()) / 86_400_000))
    : null;

  // Real phase data (base/build/peak/taper) lives on every week row — see
  // plan-ui.ts phaseSummary. Get-fit/maintain plans never reach peak/taper,
  // so they fall back to the old weeks-left framing.
  const phases = useMemo(
    () => (plan ? phaseSummary(plan.weeks, weekNum) : { pips: [], line: null }),
    [plan, weekNum]
  );
  const currentPhase = plan?.weeks.find((w) => w.weekNumber === weekNum)?.phase ?? null;

  const phaseLine =
    phases.line ??
    (plan?.intent && plan.intent !== "race"
      ? totalWeeks - weekNum > 0
        ? `${totalWeeks - weekNum} week${totalWeeks - weekNum === 1 ? "" : "s"} left`
        : "Final week"
      : daysToRace != null
      ? daysToRace > 0
        ? `${daysToRace} day${daysToRace === 1 ? "" : "s"} to ${RACE_LABEL[plan!.raceDistance] ?? "race day"}`
        : "Race week"
      : null);

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
      <NavBar
        title="Plan overview"
        large={false}
        centerAlways
        left={backButton}
        right={
          <TransitionLink
            href="/plan/manage"
            aria-label="Manage plan"
            className="press flex h-9 w-9 items-center justify-center rounded-xl bg-elevated"
          >
            <SlidersHorizontal className="h-[18px] w-[18px] text-text-1" strokeWidth={2} />
          </TransitionLink>
        }
      />

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
            className="press flex flex-col items-center gap-0.5"
          >
            <span className="text-[10px] font-bold uppercase tracking-widest text-text-3">
              {plan.intent && plan.intent !== "race"
                ? plan.name
                : `${RACE_LABEL[plan.raceDistance] ?? plan.name} · ${totalWeeks} weeks`}
            </span>
            <span className="flex items-center gap-1.5 text-[17px] font-bold text-text-1">
              Week {weekNum}
              <ChevronDown className="h-3.5 w-3.5 text-text-3" strokeWidth={2.5} />
            </span>
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

        {/* Aurora hero: km planned this week, day-progress pips, phase line */}
        <section
          className="rounded-[24px] px-[22px] py-5 text-on-accent"
          style={{ background: "var(--k-sig-aurora)" }}
        >
          <p className="text-[10px] font-extrabold uppercase tracking-widest opacity-70">
            {currentPhase
              ? `Block · ${PHASE_LABEL[currentPhase]}`
              : plan.intent && plan.intent !== "race"
              ? plan.intent.replace("_", " ")
              : "Training week"}
          </p>
          <p className="mt-1 font-display text-[38px] leading-[0.9]">
            {displayDistance(weekKm, 0)}
            <span className="ml-1 text-[17px] font-display">
              {distanceUnitLabel().toUpperCase()} PLANNED
            </span>
          </p>
          {/* One pip per training block (base/build/peak/taper) the plan
              actually uses, not per day — the day rows below already show
              day-by-day completion via their checkmarks. */}
          {phases.pips.length > 0 ? (
            <div className="mt-3.5 flex gap-1">
              {phases.pips.map((p, i) => (
                <div
                  key={i}
                  className="h-1.5 flex-1 rounded-full"
                  style={{
                    background:
                      p.state === "done" || p.state === "current"
                        ? "#0B0B0F"
                        : p.state === "next"
                        ? "rgba(11,11,15,0.33)"
                        : "rgba(11,11,15,0.13)",
                  }}
                />
              ))}
            </div>
          ) : (
            dayRows.length > 0 && (
              <div className="mt-3.5 flex gap-1">
                {dayRows.map((d, i) => (
                  <div
                    key={i}
                    className="h-1.5 flex-1 rounded-full"
                    style={{
                      background: !d.item
                        ? "rgba(11,11,15,0.13)"
                        : d.item && itemStatus(d.item) === "completed"
                        ? "#0B0B0F"
                        : "rgba(11,11,15,0.33)",
                    }}
                  />
                ))}
              </div>
            )
          )}
          {phaseLine && <p className="mt-2 text-xs font-bold">{phaseLine}</p>}
        </section>

        <p className="mx-0.5 -mb-1 text-[11px] font-extrabold uppercase tracking-widest text-text-3">
          This week
        </p>

        {/* Day rows, Monday through Sunday */}
        {dayRows.length === 0 ? (
          <p className="pt-4 text-center text-[13px] text-text-3">
            No workouts scheduled this week.
          </p>
        ) : (
          <div className="flex flex-col gap-[9px]">
            {dayRows.map((d, i) => (
              <DayRow
                key={i}
                date={d.date}
                item={d.item}
                isToday={sameDay(d.date, now)}
                onToggle={toggle}
                busy={!!d.item && busyId === d.item.id}
              />
            ))}
          </div>
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
                <span className={`text-[15px] font-bold ${selected ? "text-accent-fg" : "text-text-1"}`}>
                  Week {week.weekNumber}
                </span>
                <span className="text-[11px] text-text-3 tabular-nums">
                  {displayDistance(week.targetKm, 0)} {distanceUnitLabel()}
                </span>
              </button>
            );
          })}
        </div>
      </Sheet>
    </main>
  );
}

"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, MoreHorizontal, CheckCircle2, Flame, Wind, HeartPulse, SkipForward, Pencil, Minus, Plus, RotateCcw, Link2, Clock, CalendarClock, Undo2, Check, Flag } from "lucide-react";
import { formatPace } from "@/lib/plan-engine/pace-zones";
import { useSettings } from "@/lib/useSettings";
import { PaceChart, PaceBadge } from "@/components/PaceChart";
import { NavBar } from "@/components/ui/NavBar";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/feedback";
import { StepperButton } from "@/components/ui/StepperButton";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { useSwipeBack } from "@/lib/useSwipeBack";
import { displayDistance, distanceUnitLabel, displayPace, paceUnitLabel, displaySpeed, speedUnitLabel, actualPaceSecKm } from "@/lib/units";
import { displayWorkoutTitle } from "@/lib/plan-engine/workout-title";
import { GuidedRun, type GuidedRunFinish } from "@/components/GuidedRun";
import { AnimatePresence } from "motion/react";
import { WorkoutCelebration } from "@/components/WorkoutCelebration";
import { Radio, Play, Music } from "lucide-react";
import {
  clearRunSnapshot,
  loadRunSnapshot,
  type RunSnapshot,
} from "@/lib/run-snapshot";
import { openSpotify } from "@/lib/spotify";
import { fuelingAdvice, shouldShowFueling } from "@/lib/fueling";
import { Droplet, Zap, Sparkles } from "lucide-react";
import { WarmupPlayer } from "@/components/WarmupPlayer";
import { routineById } from "@/lib/warmup";

// RPE mapping per workout zone
const ZONE_RPE: Record<string, string> = {
  warmup: "RPE 2-3",
  cooldown: "RPE 2-3",
  recovery: "RPE 2-3",
  work: "RPE 7-8",
};
const TYPE_RPE: Record<string, string> = {
  easy: "RPE 3-4",
  recovery: "RPE 2-3",
  long: "RPE 3-4",
  tempo: "RPE 7-8",
  interval: "RPE 8-9",
  race: "RPE 9-10",
};

// ── Types ────────────────────────────────────────────────────────────────────

interface WorkoutBlock {
  type: string;
  durationMinutes?: number | null;
  distanceKm?: number | null;
  targetPaceSecKm?: number | null;
  minPaceSecKm?: number | null;
  maxPaceSecKm?: number | null;
  reps?: number | null;
  repDistanceKm?: number | null;
  repRestSeconds?: number | null;
  sortOrder: number;
}

interface WorkoutDetail {
  id: string;
  planId: string;
  type: string;
  title: string;
  description?: string | null;
  targetKm?: number | null;
  targetDurationMinutes?: number | null;
  status: string;
  rpe?: number | null;
  edited?: boolean;
  actualKm?: number | null;
  actualDurationSeconds?: number | null;
  raceFinishSeconds?: number | null;
  raceFeel?: string | null;
  date: string;
  dayOfWeek: number;
  blocks: WorkoutBlock[];
  timeOfDay?: string | null;
  // Linked recorded activity (Strava/Garmin sync) — carries the measured avg
  // pace for a completed run, the source of truth for "actual pace" below.
  activity?: { avgPaceSecKm?: number | null } | null;
}

const RACE_FEEL_OPTIONS = ["Great", "Solid", "Tough", "Struggled"] as const;

// ── Constants ────────────────────────────────────────────────────────────────

const typeColors: Record<string, string> = {
  easy: "#7BC232",
  recovery: "#7BC232",
  tempo: "#F2A113",
  interval: "#E0402E",
  long: "#8655F0",
  race: "#FF4D4D",
};

const typeLabels: Record<string, string> = {
  easy: "Easy Run",
  recovery: "Recovery",
  tempo: "Tempo",
  interval: "Intervals",
  long: "Long Run",
  race: "Race",
};

const BLOCK_LABEL: Record<string, string> = {
  warmup: "Warm-up",
  work: "Session",
  recovery: "Recovery jog",
  cooldown: "Cool-down",
};

const BLOCK_ICON: Record<string, typeof Flame> = {
  warmup: Flame,
  work: HeartPulse,
  recovery: Wind,
  cooldown: Flame,
};

// ── Coaching tips per workout type ──────────────────────────────────────────

function getCoachingTip(type: string, targetKm?: number | null, maxPace?: number | null): string {
  const paceStr = maxPace ? formatPace(displayPace(maxPace)) : null;

  switch (type) {
    case "easy":
    case "recovery":
      return `Keep this run genuinely easy. You get no extra fitness points for going fast on easy days! ${
        paceStr ? `Stay slower than ${paceStr}${paceUnitLabel()} and` : "Focus on"
      } relaxed, conversational running.`;
    case "long":
      return `Build endurance at a comfortable pace. Start easy and stay controlled throughout. ${
        targetKm && targetKm > 20 ? "Consider carrying water and fuel for this one." : "Focus on time on feet, not speed."
      }`;
    case "tempo":
      return "Comfortably hard — you should be able to speak in short sentences but not hold a full conversation. Stay controlled and resist going too fast early.";
    case "interval":
      return "Push hard during the work intervals, then recover fully between reps. The rest is important — don't cut it short. Quality over quantity.";
    case "race":
      return "Race day! Trust your training. Start conservatively and negative-split if you can. You've earned this.";
    default:
      return "Run at the prescribed effort level and listen to your body.";
  }
}

// ── Options sheet ────────────────────────────────────────────────────────────

function OptionsSheet({
  open,
  onClose,
  onSkip,
  onUnskip,
  onEdit,
  onUncomplete,
  onLinkActivity,
  onAddTime,
  onMove,
  onLogRaceResult,
  isCompleted,
  isSkipped,
  isRace,
}: {
  open: boolean;
  onClose: () => void;
  onSkip: () => void;
  onUnskip: () => void;
  onEdit: () => void;
  onUncomplete: () => void;
  onLinkActivity: () => void;
  onAddTime: () => void;
  onMove: () => void;
  onLogRaceResult: () => void;
  isCompleted: boolean;
  isSkipped: boolean;
  isRace: boolean;
}) {
  // Skip has no other entry point in the app — this menu is the only place to
  // reverse it, so "Restore" must always sit right where "Skip" would be.
  const statusAction = isCompleted
    ? { label: "Mark as not completed", Icon: RotateCcw, action: onUncomplete }
    : isSkipped
    ? { label: "Restore workout", Icon: Undo2, action: onUnskip }
    : { label: "Skip workout", Icon: SkipForward, action: onSkip };

  const actions = [
    // Race day's own action leads the menu instead of living as a second,
    // standalone button next to this same menu.
    ...(isRace ? [{ label: "Log race result", Icon: Flag, action: onLogRaceResult }] : []),
    ...(!isCompleted && !isSkipped ? [{ label: "Edit workout", Icon: Pencil, action: onEdit }] : []),
    statusAction,
    { label: "Link activity", Icon: Link2, action: onLinkActivity },
    { label: "Add workout time", Icon: Clock, action: onAddTime },
    { label: "Move workout", Icon: CalendarClock, action: onMove },
  ];

  return (
    <Sheet open={open} onClose={onClose} title="Workout options">
      <div className="flex flex-col gap-1 pb-2">
        {actions.map(({ label, Icon, action }) => (
          <button
            key={label}
            onClick={() => {
              haptic("light");
              action();
              onClose();
            }}
            className="press flex w-full items-center gap-3 rounded-[var(--radius-input)] px-2 py-3.5 text-left active:bg-elevated"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-elevated">
              <Icon className="h-[18px] w-[18px] text-text-2" strokeWidth={1.9} />
            </span>
            <span className="text-[15px] font-medium text-text-1">{label}</span>
          </button>
        ))}
        <div className="pt-2">
          <Button variant="secondary" full onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

// ── Edit workout (distance + pace override) ──────────────────────────────────

function EditWorkoutSheet({
  open,
  onClose,
  workout,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  workout: WorkoutDetail;
  onSaved: () => void;
}) {
  const [km, setKm] = useState<number | null>(workout.targetKm ?? null);
  const [paceOffset, setPaceOffset] = useState(0);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reseed form fields when sheet opens
      setKm(workout.targetKm ?? null);
      setPaceOffset(0);
      setErr(null);
    }
  }, [open, workout.targetKm]);

  const hasPace = workout.blocks.some((b) => b.targetPaceSecKm != null);
  // Distance edits only apply to sessions with a plain-distance main block —
  // interval sessions keep their rep structure (adjust pace instead).
  const plainWork = workout.blocks.filter(
    (b) => b.type === "work" && b.distanceKm != null && !b.reps
  );
  const canEditDistance = plainWork.length > 0 && workout.targetKm != null;
  const fixedKm =
    workout.blocks
      .filter((b) => !(b.type === "work" && b.distanceKm != null && !b.reps))
      .reduce((sum, b) => sum + (b.distanceKm ?? 0), 0) +
    workout.blocks.reduce(
      (sum, b) => sum + (b.reps && b.repDistanceKm ? b.reps * b.repDistanceKm : 0),
      0
    );
  const minKm = Math.max(1, Math.round((fixedKm + 0.2 * plainWork.length) * 10) / 10);
  const paceFields = workout.blocks.flatMap((b) =>
    [b.targetPaceSecKm, b.minPaceSecKm, b.maxPaceSecKm].filter((v): v is number => v != null)
  );
  const minPaceField = paceFields.length ? Math.min(...paceFields) : null;
  const minOffset = minPaceField != null ? Math.max(-60, 120 - minPaceField) : -60;
  const kmChanged = km != null && workout.targetKm != null && km !== workout.targetKm;
  const dirty = (canEditDistance && kmChanged) || paceOffset !== 0;

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setErr(null);
    try {
      const body: Record<string, number> = {};
      if (canEditDistance && kmChanged && km != null) body.targetKm = km;
      if (paceOffset !== 0) body.paceOffsetSecKm = paceOffset;
      const res = await apiFetch(`/api/plans/${workout.planId}/workouts/${workout.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErr(data?.error ?? "Couldn't save the changes — try again.");
        return;
      }
      haptic("success");
      onSaved();
    } catch {
      setErr("Couldn't save the changes — try again.");
    } finally {
      setSaving(false);
    }
  }

  // Editing this workout also opts it out of the next plan regenerate (it's
  // preserved the same way a completed workout is — see regenerate-merge.ts).
  // Without an undo, that override would be permanent even after the athlete
  // no longer wants it. This clears the "edited" flag only; the current
  // numbers stay until the athlete next changes the plan, at which point a
  // fresh, coached value for this day takes over.
  async function resetToPlan() {
    if (resetting) return;
    setResetting(true);
    setErr(null);
    try {
      const res = await apiFetch(`/api/plans/${workout.planId}/workouts/${workout.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edited: false }),
      });
      if (!res.ok) {
        setErr("Couldn't reset this workout — try again.");
        return;
      }
      haptic("success");
      onSaved();
    } catch {
      setErr("Couldn't reset this workout — try again.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Edit workout">
      <div className="flex flex-col gap-5 px-4 pb-6">
        <p className="text-[13px] text-text-3">
          Tunes this session only, the rest of the plan stays as coached. A
          hand-tuned session also stays put when you later edit the plan.
        </p>

        {canEditDistance && km != null && (
          <div>
            <p className="mb-2 text-[13px] font-semibold text-text-2">Distance</p>
            <div className="flex items-center justify-center gap-5">
              <StepperButton
                ariaLabel="Less distance"
                onClick={() => { haptic("light"); setKm((v) => Math.max(minKm, Math.round(((v ?? 1) - 0.5) * 10) / 10)); }}
              >
                <Minus className="h-5 w-5 text-text-1" strokeWidth={2.2} />
              </StepperButton>
              <span className="min-w-[110px] text-center text-[28px] font-extrabold tabular-nums text-text-1">
                {km.toFixed(1)} <span className="text-[15px] font-semibold text-text-3">km</span>
              </span>
              <StepperButton
                ariaLabel="More distance"
                onClick={() => { haptic("light"); setKm((v) => Math.min(60, Math.round(((v ?? 0) + 0.5) * 10) / 10)); }}
              >
                <Plus className="h-5 w-5 text-text-1" strokeWidth={2.2} />
              </StepperButton>
            </div>
            <p className="mt-1.5 text-center text-[12px] text-text-3">
              Warm-up and cool-down stay fixed; the main session scales.
            </p>
          </div>
        )}

        {!canEditDistance && (
          <p className="rounded-[var(--radius-input)] bg-elevated px-3.5 py-2.5 text-[13px] text-text-3">
            This session&apos;s distance comes from its intervals — adjust the pace instead.
          </p>
        )}

        {hasPace && (
          <div>
            <p className="mb-2 text-[13px] font-semibold text-text-2">Pace targets</p>
            <div className="flex items-center justify-center gap-5">
              <StepperButton
                ariaLabel="Faster paces"
                onClick={() => { haptic("light"); setPaceOffset((v) => Math.max(minOffset, v - 5)); }}
              >
                <Minus className="h-5 w-5 text-text-1" strokeWidth={2.2} />
              </StepperButton>
              <span className="min-w-[110px] text-center text-[28px] font-extrabold tabular-nums text-text-1">
                {paceOffset > 0 ? "+" : ""}{paceOffset}
                <span className="text-[15px] font-semibold text-text-3"> s/km</span>
              </span>
              <StepperButton
                ariaLabel="Slower paces"
                onClick={() => { haptic("light"); setPaceOffset((v) => Math.min(60, v + 5)); }}
              >
                <Plus className="h-5 w-5 text-text-1" strokeWidth={2.2} />
              </StepperButton>
            </div>
            <p className="mt-1.5 text-center text-[12px] text-text-3">
              + is easier (slower), − is harder. Applies to every pace in this session.
            </p>
          </div>
        )}

        {err && (
          <p className="rounded-[var(--radius-input)] bg-danger/10 px-3.5 py-2.5 text-[13px] font-medium text-danger">{err}</p>
        )}

        <Button full busy={saving} disabled={!dirty} onClick={save}>
          Save changes
        </Button>
        {workout.edited && (
          <Button variant="secondary" full busy={resetting} onClick={resetToPlan}>
            Reset to plan
          </Button>
        )}
      </div>
    </Sheet>
  );
}

// ── Link activity ────────────────────────────────────────────────────────────
// Reuses the same relationship the Activities tab's "Link this activity" flow
// writes (activities.workoutId via PATCH /api/activities/[id]) — just entered
// from the workout side instead of the activity side, so there's one link
// concept, not two.

interface LinkableActivity {
  id: string;
  date: string;
  title: string;
  distanceKm: number | null;
  durationSeconds: number | null;
}

const LINK_WINDOW_DAYS = 10;

function LinkActivitySheet({
  open,
  onClose,
  workout,
  onLinked,
}: {
  open: boolean;
  onClose: () => void;
  workout: WorkoutDetail;
  onLinked: () => void;
}) {
  const [candidates, setCandidates] = useState<LinkableActivity[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload each time the sheet opens
    setCandidates(null);
    (async () => {
      try {
        // /api/activities defaults to a rolling 12-month window — a workout
        // from further back would otherwise have no linkable candidates at
        // all. Ask it for exactly the +/- LINK_WINDOW_DAYS range around this
        // workout's date instead, which also keeps the request small.
        const anchor = new Date(workout.date).getTime();
        const windowMs = LINK_WINDOW_DAYS * 24 * 60 * 60 * 1000;
        const from = new Date(anchor - windowMs).toISOString();
        const to = new Date(anchor + windowMs).toISOString();
        const res = await apiFetch(
          `/api/activities?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const runs: LinkableActivity[] = (data.activities ?? [])
          .filter((a: { kind: string; workoutId: string | null; date: string }) =>
            a.kind === "run" &&
            !a.workoutId &&
            Math.abs(new Date(a.date).getTime() - anchor) <= windowMs
          )
          .sort(
            (a: LinkableActivity, b: LinkableActivity) =>
              Math.abs(new Date(a.date).getTime() - anchor) -
              Math.abs(new Date(b.date).getTime() - anchor)
          )
          .slice(0, 10)
          .map((a: LinkableActivity) => ({
            id: a.id,
            date: a.date,
            title: a.title,
            distanceKm: a.distanceKm,
            durationSeconds: a.durationSeconds,
          }));
        if (!cancelled) setCandidates(runs);
      } catch {
        if (!cancelled) setCandidates([]);
      }
    })();
    return () => { cancelled = true; };
  }, [open, workout.date]);

  async function link(activityId: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/activities/${activityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: workout.id }),
      });
      if (res.ok) {
        haptic("success");
        onLinked();
      } else {
        haptic("warning");
      }
    } finally {
      setBusy(false);
    }
  }

  const fmtDay = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });

  return (
    <Sheet open={open} onClose={onClose} title="Link an activity">
      <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pb-2">
        <p className="text-[13px] text-text-3">
          Attach a recorded run to this session, so it counts toward your plan.
        </p>
        {candidates === null ? (
          <Skeleton className="h-24 w-full" />
        ) : candidates.length === 0 ? (
          <p className="text-[13px] text-text-2">No unlinked runs near this date.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {candidates.map((a) => (
              <button
                key={a.id}
                disabled={busy}
                onClick={() => link(a.id)}
                className="press flex items-center gap-3 rounded-[var(--radius-input)] bg-elevated px-3 py-2.5 text-left disabled:opacity-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-text-1">{a.title}</span>
                  <span className="block text-[12px] text-text-3">
                    {fmtDay(a.date)}
                    {a.distanceKm ? ` · ${displayDistance(a.distanceKm)} ${distanceUnitLabel()}` : ""}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

// ── Add workout time ─────────────────────────────────────────────────────────
// Null means "no specific time" — never rendered or saved as midnight. Time
// is always stored regardless of calendar connection; only the "also synced"
// message depends on it, so the UI never implies a sync that didn't happen.

function AddTimeSheet({
  open,
  onClose,
  workout,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  workout: WorkoutDetail;
  onSaved: (timeOfDay: string | null) => void;
}) {
  const [time, setTime] = useState(workout.timeOfDay ?? "");
  const [gcalConnected, setGcalConnected] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reseed from the current workout each open
    setTime(workout.timeOfDay ?? "");
    setErr(null);
    apiFetch("/api/integrations/gcal/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setGcalConnected(d ? Boolean(d.connected) : false))
      .catch(() => setGcalConnected(false));
  }, [open, workout.timeOfDay]);

  async function save(value: string | null) {
    if (saving) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await apiFetch(`/api/plans/${workout.planId}/workouts/${workout.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeOfDay: value }),
      });
      if (res.ok) {
        haptic("success");
        onSaved(value);
      } else {
        setErr("Couldn't save the time — try again.");
      }
    } catch {
      setErr("Couldn't save the time — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add workout time">
      <div className="flex flex-col gap-4 px-4 pb-6">
        <p className="text-[13px] text-text-3">
          Set a time of day for this session. Leave it blank to keep just the date.
        </p>
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="w-full rounded-[var(--radius-input)] bg-elevated px-3.5 py-3 text-center text-[22px] font-bold tabular-nums text-text-1 outline-none focus:ring-2 focus:ring-accent/40"
        />
        <p className="text-[12px] text-text-3">
          {gcalConnected === null
            ? " "
            : gcalConnected
            ? "This will also update your Google Calendar event."
            : "Saved here only — connect Google Calendar in Settings to sync it there too."}
        </p>
        {err && (
          <p className="rounded-[var(--radius-input)] bg-danger/10 px-3.5 py-2.5 text-[13px] font-medium text-danger">{err}</p>
        )}
        <Button full busy={saving} onClick={() => save(time || null)}>
          Save time
        </Button>
        {workout.timeOfDay != null && (
          <Button variant="secondary" full busy={saving} onClick={() => { setTime(""); save(null); }}>
            Clear time
          </Button>
        )}
      </div>
    </Sheet>
  );
}

// ── Back button ──────────────────────────────────────────────────────────────

function BackButton() {
  const router = useRouter();
  return (
    <button
      onClick={() => {
        haptic("light");
        router.back();
      }}
      className="press flex h-11 items-center gap-0.5 text-accent-fg"
      aria-label="Back"
    >
      <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
      <span className="text-[17px]">Back</span>
    </button>
  );
}

// ── Race result capture ──────────────────────────────────────────────────────
// Distance is already known from the plan — the only essential input is the
// finish time. Feel is a one-tap extra, cheap to skip.

function RaceResultSheet({
  open,
  onClose,
  initialSeconds,
  onSubmit,
  saving,
  error,
}: {
  open: boolean;
  onClose: () => void;
  initialSeconds: number | null;
  onSubmit: (finishSeconds: number, feel: string | null) => void;
  saving: boolean;
  error: string | null;
}) {
  const [h, setH] = useState(0);
  const [m, setM] = useState(0);
  const [s, setS] = useState(0);
  const [feel, setFeel] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const total = Math.max(0, Math.round(initialSeconds ?? 0));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reseed form fields when sheet opens
      setH(Math.floor(total / 3600));
      setM(Math.floor((total % 3600) / 60));
      setS(total % 60);
      setFeel(null);
    }
  }, [open, initialSeconds]);

  const totalSeconds = h * 3600 + m * 60 + s;
  const valid = totalSeconds > 0;

  return (
    <Sheet open={open} onClose={onClose} title="Log race result">
      <div className="flex flex-col gap-5 px-4 pb-6">
        <p className="text-[13px] text-text-3">
          Distance comes from the plan. Just the finish time.
        </p>

        <div className="flex items-center justify-center gap-2">
          {[
            { label: "hrs", value: h, set: setH, max: 47 },
            { label: "min", value: m, set: setM, max: 59 },
            { label: "sec", value: s, set: setS, max: 59 },
          ].map(({ label, value, set, max }) => (
            <div key={label} className="flex flex-col items-center gap-1">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={max}
                value={value}
                onChange={(e) => {
                  const n = Math.max(0, Math.min(max, Math.floor(Number(e.target.value) || 0)));
                  set(n);
                }}
                className="w-[72px] rounded-[var(--radius-input)] bg-elevated px-2 py-3 text-center text-[24px] font-extrabold tabular-nums text-text-1"
              />
              <span className="text-[11px] uppercase tracking-wide text-text-3">{label}</span>
            </div>
          ))}
        </div>

        <div>
          <p className="mb-2 text-[13px] font-semibold text-text-2">How did it feel?</p>
          <div className="flex flex-wrap gap-2">
            {RACE_FEEL_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  haptic("light");
                  setFeel((prev) => (prev === option ? null : option));
                }}
                className={`press rounded-full px-3.5 py-2 text-[13px] font-semibold ${
                  feel === option ? "bg-accent text-on-accent" : "bg-elevated text-text-2"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="rounded-[var(--radius-input)] bg-danger/10 px-3.5 py-2.5 text-[13px] font-medium text-danger">
            {error}
          </p>
        )}

        <Button full busy={saving} disabled={!valid} onClick={() => onSubmit(totalSeconds, feel)}>
          Save result
        </Button>
      </div>
    </Sheet>
  );
}

// ── Post-race screen ─────────────────────────────────────────────────────────
// Shown once, right after a result is logged — a result card plus what-now
// options, so there's no gap the morning after race day.

function PostRaceScreen({
  title,
  finishSeconds,
  distanceKm,
  feel,
  units,
  planClosed,
  onClose,
}: {
  title: string;
  finishSeconds: number;
  distanceKm: number | null;
  feel: string | null;
  units: "km" | "miles";
  planClosed: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg px-5 pb-tabbar pt-10">
      <div className="flex flex-1 flex-col items-center overflow-y-auto text-center">
        <div className="w-full rounded-[var(--radius-card)] bg-accent p-6 text-on-accent">
          <p className="text-[12px] font-bold uppercase tracking-wide opacity-80">
            {title} · done
          </p>
          <p className="mt-1 text-[40px] font-extrabold tabular-nums">
            {fmtDurationShort(finishSeconds)}
          </p>
          <p className="mt-1 text-[12px] opacity-80">
            {distanceKm != null ? `${displayDistance(distanceKm, 1, units)}${distanceUnitLabel(units)}` : ""}
            {feel ? `${distanceKm != null ? " · " : ""}Felt: ${feel}` : ""}
          </p>
        </div>

        {planClosed && (
          <p className="mt-4 text-[13px] leading-relaxed text-text-3">
            This plan has nothing left to give you — it stays in your history exactly as it ran.
          </p>
        )}

        <p className="mt-6 self-start text-[13px] font-bold uppercase tracking-wide text-text-3">
          What now
        </p>
        <div className="mt-2 flex w-full flex-col gap-2.5">
          <button
            onClick={() => {
              haptic("light");
              router.push("/create");
            }}
            className="press flex w-full flex-col items-start rounded-[var(--radius-card)] bg-surface px-4 py-3.5 text-left"
          >
            <span className="text-[14.5px] font-bold text-text-1">Plan the next race</span>
            <span className="mt-0.5 text-[12px] text-text-3">Recovery week first, then a fresh build</span>
          </button>
          <button
            onClick={() => {
              haptic("light");
              router.push("/");
            }}
            className="press flex w-full flex-col items-start rounded-[var(--radius-card)] bg-surface px-4 py-3.5 text-left"
          >
            <span className="text-[14.5px] font-bold text-text-1">Run without a plan for now</span>
            <span className="mt-0.5 text-[12px] text-text-3">Log what you do, no structure until you&apos;re ready</span>
          </button>
        </div>
      </div>
      <Button variant="secondary" full onClick={onClose}>
        Decide later
      </Button>
    </div>
  );
}

// ── Main Workout Detail Page ────────────────────────────────────────────────

/**
 * "(2 km · 12 mins)" — either part alone, or nothing at all. The old inline
 * version relied on `a ?? b ? c : d` precedence and rendered a duration-only
 * block as "(0km2 mins)" on every interval workout.
 */
function blockDetail(
  block: { distanceKm?: number | null; durationMinutes?: number | null },
  units: "km" | "miles"
): string {
  const parts: string[] = [];
  if (block.distanceKm != null) {
    parts.push(`${displayDistance(block.distanceKm, 1, units)}${distanceUnitLabel(units)}`);
  }
  if (block.durationMinutes != null) {
    parts.push(`${block.durationMinutes} mins`);
  }
  return parts.length > 0 ? ` (${parts.join(" · ")})` : "";
}

// Compact elapsed-time label: h:mm:ss over an hour, else m:ss. Never renders a
// sub-second run (fleet convention: nothing shorter than one second).
function fmtDurationShort(totalSeconds: number): string {
  const s = Math.max(1, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

// "HH:mm" 24h stored value → locale time string. Only called when a time is
// actually set — null/undefined never reaches here as "00:00".
function formatTimeOfDay(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// Carbs + hydration guidance for long runs and race day.
function FuelingCard({ type, durationMinutes }: { type: string; durationMinutes: number | null }) {
  if (!shouldShowFueling(type, durationMinutes)) return null;
  const advice = fuelingAdvice(durationMinutes ?? 0, type);
  if (!advice) return null;
  return (
    <section className="rounded-[var(--radius-card)] bg-surface p-4">
      <div className="flex items-center gap-2">
        <Zap className="h-4 w-4 text-accent-fg" strokeWidth={2.4} />
        <h2 className="text-[15px] font-bold text-text-1">
          {advice.showChecklist ? "Race-day fuelling" : "Fuelling"}
        </h2>
      </div>
      {advice.carbsPerHour > 0 && (
        <div className="mt-3 flex gap-8">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-text-3">Carbs</p>
            <p className="text-[20px] font-extrabold tabular-nums text-text-1">
              {advice.carbsPerHour}
              <span className="text-[12px] font-semibold text-text-3"> g/h</span>
            </p>
            <p className="text-[11px] text-text-3">~{advice.totalCarbsG} g total</p>
          </div>
          <div>
            <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-text-3">
              <Droplet className="h-3 w-3" strokeWidth={2.4} /> Fluid
            </p>
            <p className="text-[20px] font-extrabold tabular-nums text-text-1">
              {advice.hydrationMlPerHour}
              <span className="text-[12px] font-semibold text-text-3"> ml/h</span>
            </p>
          </div>
        </div>
      )}
      <ul className="mt-3 flex flex-col gap-1.5">
        {advice.tips.map((t, i) => (
          <li key={i} className="flex gap-2 text-[13px] leading-snug text-text-2">
            <span className="text-accent-fg">·</span>
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Opens Spotify (app if installed, else web player) so the athlete can line up
// music before a run. No account/scopes — just a launch.
function MusicButton() {
  return (
    <button
      onClick={() => {
        haptic("light");
        openSpotify();
      }}
      className="press flex w-full items-center justify-center gap-2 py-2.5 text-[14px] font-semibold text-text-2"
    >
      <Music className="h-4 w-4" strokeWidth={2.2} />
      Open Spotify for music
    </button>
  );
}

export default function WorkoutDetailPage({ params }: { params: Promise<{ id: string }> }) {
  useSwipeBack();
  const { id } = use(params);
  const router = useRouter();
  const settings = useSettings();
  const useMiles = settings.units === "miles";
  const showPace = settings.paceTargets;
  const showEasyPace = settings.paceTargetsEasyRuns;
  const showLongPace = settings.paceTargetsLongRuns;
  const useRpe = settings.workoutTargetMode === "rpe";
  const [workout, setWorkout] = useState<WorkoutDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [mode, setMode] = useState<"outdoor" | "treadmill">("outdoor");
  const [menuOpen, setMenuOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [guiding, setGuiding] = useState(false);
  const [warmupRoutine, setWarmupRoutine] = useState<string | null>(null);
  // A parked/reloaded run for THIS workout, offered as "Resume". `resuming`
  // distinguishes reopening it (restore state) from a fresh Start.
  const [resumeSnap, setResumeSnap] = useState<RunSnapshot | null>(null);
  const [resuming, setResuming] = useState(false);

  useEffect(() => {
    const snap = loadRunSnapshot();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is client-only
    if (snap && snap.workoutId === id) setResumeSnap(snap);
  }, [id]);

  const [editOpen, setEditOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);

  // Race-day result capture: the sheet, its prefill (from a guided run, if
  // one was used), and the post-race screen shown once a result is saved.
  const [raceResultOpen, setRaceResultOpen] = useState(false);
  const [raceResultPrefillSeconds, setRaceResultPrefillSeconds] = useState<number | null>(null);
  const [raceResultSaving, setRaceResultSaving] = useState(false);
  const [raceResultError, setRaceResultError] = useState<string | null>(null);
  const [postRace, setPostRace] = useState<{
    finishSeconds: number;
    distanceKm: number | null;
    feel: string | null;
    planClosed: boolean;
  } | null>(null);

  async function loadWorkout() {
    try {
      const res = await apiFetch(`/api/workouts/${id}`);
      if (res.status === 404) {
        setError("Workout not found.");
        return;
      }
      if (!res.ok) throw new Error("Failed");
      setWorkout(await res.json());
    } catch {
      setError("Couldn't load this workout. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data load, not a render cascade
    loadWorkout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleComplete() {
    if (!workout || completing) return;
    setCompleting(true);
    setActionError(null);
    try {
      const res = await apiFetch(`/api/workouts/${workout.id}/complete`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (res.ok) {
        haptic("success");
        setWorkout((prev) => prev ? { ...prev, status: "completed" } : prev);
        setCelebrating(true);
      } else {
        setActionError("Couldn't save your workout. Please try again.");
      }
    } catch {
      setActionError("Couldn't save your workout. Please try again.");
    } finally {
      setCompleting(false);
    }
  }

  // Fires on a fresh completion only, so revisiting a done workout is quiet.
  const [celebrating, setCelebrating] = useState(false);
  const [celebrationDetail, setCelebrationDetail] = useState<string | null>(null);

  const [rpeSaving, setRpeSaving] = useState(false);
  async function handleRpe(rpe: number) {
    if (!workout || rpeSaving) return;
    setRpeSaving(true);
    try {
      const res = await apiFetch(`/api/workouts/${workout.id}/complete`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rpe }),
      });
      if (res.ok) {
        haptic("success");
        setWorkout((prev) => (prev ? { ...prev, rpe } : prev));
        // Readiness listens for this to recompute.
        window.dispatchEvent(new Event("kadenz:wellness-saved"));
      }
    } catch {
      /* leave chips visible for retry */
    } finally {
      setRpeSaving(false);
    }
  }

  function markCompletedLocally(summary: GuidedRunFinish) {
    const km = summary.distanceKm;
    const mins = Math.round(summary.elapsedSeconds / 60);
    setCelebrationDetail(
      km != null && km > 0
        ? `${km.toFixed(2)} km in ${mins} min`
        : mins > 0
          ? `${mins} min`
          : null
    );
    setCelebrating(true);
    setWorkout((prev) =>
      prev
        ? {
            ...prev,
            status: "completed",
            actualKm: summary.distanceKm ?? prev.actualKm,
            actualDurationSeconds:
              summary.elapsedSeconds > 0 ? summary.elapsedSeconds : prev.actualDurationSeconds,
          }
        : prev
    );
  }

  async function handleGuidedFinish(summary: GuidedRunFinish) {
    setGuiding(false);
    setResuming(false);
    setResumeSnap(null);
    if (!workout) return;
    setActionError(null);

    const isRaceWorkout = workout.type === "race";

    try {
      // With GPS: save the whole run as an activity (route + splits) linked to
      // the workout, so it lands in the Activities feed with a map.
      if (summary.distanceKm != null && summary.distanceKm > 0) {
        const res = await apiFetch(`/api/workouts/${workout.id}/record`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            distanceKm: summary.distanceKm,
            durationSeconds: summary.elapsedSeconds,
            ...(summary.polyline ? { polyline: summary.polyline } : {}),
            ...(summary.splits ? { splits: summary.splits } : {}),
            startedAt: new Date(Date.now() - summary.elapsedSeconds * 1000).toISOString(),
          }),
        });
        if (res.ok) {
          haptic("success");
          // A race workout still needs the deliberate result-logging step —
          // the recorded activity is evidence (map, splits), not the result
          // itself, and GPS elapsed time can differ from an official gun/chip
          // time the athlete may want to enter instead.
          if (isRaceWorkout) {
            setRaceResultPrefillSeconds(summary.elapsedSeconds > 0 ? summary.elapsedSeconds : null);
            setRaceResultOpen(true);
          } else {
            markCompletedLocally(summary);
          }
          return;
        }
        // Fall through to a plain completion if recording failed.
      }

      if (isRaceWorkout) {
        setRaceResultPrefillSeconds(summary.elapsedSeconds > 0 ? summary.elapsedSeconds : null);
        setRaceResultOpen(true);
        return;
      }

      // No GPS distance (or record failed): just mark the workout complete.
      const res = await apiFetch(`/api/workouts/${workout.id}/complete`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(summary.distanceKm != null ? { actualKm: summary.distanceKm } : {}),
          ...(summary.elapsedSeconds > 0 ? { durationSeconds: summary.elapsedSeconds } : {}),
        }),
      });
      if (res.ok) {
        haptic("success");
        markCompletedLocally(summary);
      } else {
        setActionError("Run saved locally, but we couldn't mark it complete. Try again.");
      }
    } catch {
      setActionError("Run saved locally, but we couldn't mark it complete. Try again.");
    }
  }

  async function submitRaceResult(finishSeconds: number, feel: string | null) {
    if (!workout || raceResultSaving) return;
    setRaceResultSaving(true);
    setRaceResultError(null);
    try {
      const res = await apiFetch(`/api/workouts/${workout.id}/race-result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finishSeconds, feel: feel ?? undefined }),
      });
      if (res.ok) {
        const data = await res.json();
        haptic("success");
        setWorkout((prev) =>
          prev
            ? {
                ...prev,
                status: "completed",
                actualDurationSeconds: finishSeconds,
                raceFinishSeconds: finishSeconds,
                raceFeel: feel,
              }
            : prev
        );
        setRaceResultOpen(false);
        setPostRace({
          finishSeconds,
          distanceKm: workout.targetKm ?? null,
          feel,
          planClosed: data.planStatus === "completed",
        });
      } else {
        const data = await res.json().catch(() => null);
        setRaceResultError(data?.error ?? "Couldn't save your result. Try again.");
      }
    } catch {
      setRaceResultError("Couldn't save your result. Try again.");
    } finally {
      setRaceResultSaving(false);
    }
  }

  // "skipped" is a real status (not a delete or a fake zero-distance
  // completion) so the session stays visible in the plan and in adherence
  // instead of vanishing. This menu is the only place to set or undo it, so
  // it must stay on the page rather than navigating away.
  async function handleSkip() {
    if (!workout) return;
    try {
      const res = await apiFetch(`/api/plans/${workout.planId}/workouts/${workout.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "skipped" }),
      });
      if (res.ok) {
        haptic("light");
        setWorkout((prev) => (prev ? { ...prev, status: "skipped" } : prev));
      } else {
        setActionError("Couldn't skip this workout. Please try again.");
      }
    } catch {
      setActionError("Couldn't skip this workout. Please try again.");
    }
  }

  async function handleUnskip() {
    if (!workout) return;
    try {
      const res = await apiFetch(`/api/plans/${workout.planId}/workouts/${workout.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "planned" }),
      });
      if (res.ok) {
        haptic("light");
        setWorkout((prev) => (prev ? { ...prev, status: "planned" } : prev));
      } else {
        setActionError("Couldn't restore this workout. Please try again.");
      }
    } catch {
      setActionError("Couldn't restore this workout. Please try again.");
    }
  }

  async function handleUncomplete() {
    if (!workout) return;
    try {
      const res = await apiFetch(`/api/plans/${workout.planId}/workouts/${workout.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "planned" }),
      });
      if (res.ok) {
        haptic("light");
        setWorkout((prev) => (prev ? { ...prev, status: "planned", rpe: null } : prev));
      } else {
        setActionError("Couldn't undo the completion. Please try again.");
      }
    } catch {
      setActionError("Couldn't undo the completion. Please try again.");
    }
  }

  if (loading) {
    return (
      <main className="min-h-dvh bg-bg">
        <NavBar title="Workout" large={false} left={<BackButton />} />
        <div className="px-4 pb-tabbar flex flex-col gap-3 pt-2">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </main>
    );
  }

  if (error || !workout) {
    return (
      <main className="min-h-dvh bg-bg">
        <NavBar title="Workout" large={false} left={<BackButton />} />
        <div className="flex flex-col items-center justify-center gap-3 px-8 py-16 text-center pb-tabbar">
          <p className="text-[15px] text-text-2">{error ?? "Workout not found"}</p>
          <Button variant="secondary" onClick={() => router.back()}>Go back</Button>
        </div>
      </main>
    );
  }

  const color = typeColors[workout.type] ?? "#FAFAFA";
  const isCompleted = workout.status === "completed";
  const isSkipped = workout.status === "skipped";
  const isRace = workout.type === "race";
  // Achieved pace, not the planned block target — see lib/units.ts.
  const achievedPace = isCompleted ? actualPaceSecKm(workout) : null;
  const workoutDate = new Date(workout.date);
  const dateStr = workoutDate.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });

  // Fast cap for the coaching tip ("stay slower than X") — the E zone's
  // fastest allowed pace, not its slow end.
  const easyBlock = workout.blocks.find((b) => b.type === "warmup" || b.type === "cooldown");
  const maxPace = easyBlock?.minPaceSecKm ?? workout.blocks[0]?.minPaceSecKm;

  return (
    <>
    <main className="min-h-dvh bg-bg">
      <NavBar
        title={displayWorkoutTitle(workout, settings.units)}
        large={false}
        left={<BackButton />}
        right={
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                if (isCompleted) {
                  haptic("light");
                  handleUncomplete();
                } else if (isRace) {
                  // Same reasoning as the primary CTA: a race needs its
                  // finish time, so completing it always goes through the
                  // result sheet, never a bare status flip.
                  haptic("medium");
                  setRaceResultPrefillSeconds(workout.raceFinishSeconds ?? null);
                  setRaceResultOpen(true);
                } else {
                  haptic("success");
                  handleComplete();
                }
              }}
              disabled={completing}
              className="press flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-50"
              aria-label={isCompleted ? "Mark as not completed" : isRace ? "Log race result" : "Mark complete"}
              aria-pressed={isCompleted}
            >
              {isCompleted ? (
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent">
                  <Check className="h-4 w-4 text-on-accent" strokeWidth={3} />
                </span>
              ) : (
                <span className="h-6 w-6 rounded-full border-2 border-text-3" />
              )}
            </button>
            <button
              onClick={() => {
                haptic("light");
                setMenuOpen(true);
              }}
              className="press flex h-11 w-11 items-center justify-center rounded-full"
              aria-label="More options"
            >
              <MoreHorizontal className="h-5 w-5 text-text-2" strokeWidth={2} />
            </button>
          </div>
        }
      />

      <div className="px-4 pb-tabbar flex flex-col gap-4 pt-1">
        {/* Hero card with workout-type accent */}
        <section
          className="rounded-[var(--radius-card)] p-4"
          style={{ backgroundColor: `${color}1A` }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                <span className="text-[13px] font-semibold text-text-2">
                  {typeLabels[workout.type] ?? workout.type} · {dateStr}
                  {workout.timeOfDay ? ` · ${formatTimeOfDay(workout.timeOfDay)}` : ""}
                </span>
              </div>
              {/* The feed card truncates a title to one line (see WorkoutCard in
                  app/page.tsx); this hero has no card below it competing for
                  vertical space, so it gets two lines instead of one before
                  capping — still bounded, just not as tight, for the rare
                  hand-edited or km-baked title long enough to wrap. */}
              <h1 className="mt-1.5 line-clamp-2 text-[22px] font-bold tracking-tight text-text-1">
                {displayWorkoutTitle(workout, settings.units)}
                {workout.edited && (
                  <span className="ml-2 align-middle rounded-md bg-elevated px-2 py-0.5 text-[11px] font-bold text-text-3">Edited</span>
                )}
                {isSkipped && (
                  <span className="ml-2 align-middle rounded-md bg-text-3/20 px-2 py-0.5 text-[11px] font-bold text-text-2">Skipped</span>
                )}
              </h1>
            </div>
            {isCompleted ? (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent">
                <CheckCircle2 className="h-5 w-5 text-on-accent" strokeWidth={2.4} />
              </div>
            ) : (
              <div className="h-8 w-8 shrink-0 rounded-full border-2 border-text-3" />
            )}
          </div>

          {/* Stats row */}
          <div className="flex items-end gap-6 mt-5">
            {workout.targetKm != null && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-text-3">Distance</p>
                <p className="text-[22px] font-extrabold tabular-nums text-text-1">
                  {displayDistance(workout.targetKm, 1, settings.units)}{distanceUnitLabel(settings.units)}
                </p>
              </div>
            )}
            {workout.targetDurationMinutes != null && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-text-3">Time</p>
                <p className="text-[22px] font-extrabold tabular-nums text-text-1">
                  {workout.targetDurationMinutes > 5
                    ? `${workout.targetDurationMinutes - 5}m - ${workout.targetDurationMinutes + 5}m`
                    : `~${workout.targetDurationMinutes}m`}
                </p>
              </div>
            )}
            <div className="ml-auto">
              <PaceBadge blocks={workout.blocks} workoutType={workout.type} color={color} useMiles={useMiles} />
            </div>
          </div>

          {/* Actual result (guided phone run, or a synced Strava/Garmin activity) */}
          {isCompleted &&
            ((workout.actualKm != null && workout.actualKm > 0) ||
              (workout.actualDurationSeconds != null && workout.actualDurationSeconds > 0) ||
              achievedPace != null) && (
              <div className="mt-4 flex items-end gap-8 rounded-[var(--radius-card)] bg-elevated px-4 py-3">
                {workout.actualKm != null && workout.actualKm > 0 && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-accent-fg">Actual distance</p>
                    <p className="text-[20px] font-extrabold tabular-nums text-text-1">
                      {displayDistance(workout.actualKm, 2, settings.units)}
                      {distanceUnitLabel(settings.units)}
                    </p>
                  </div>
                )}
                {workout.actualDurationSeconds != null && workout.actualDurationSeconds > 0 && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-accent-fg">Actual time</p>
                    <p className="text-[20px] font-extrabold tabular-nums text-text-1">
                      {fmtDurationShort(workout.actualDurationSeconds)}
                    </p>
                  </div>
                )}
                {achievedPace != null && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-accent-fg">Actual pace</p>
                    <p className="text-[20px] font-extrabold tabular-nums text-text-1">
                      {formatPace(displayPace(achievedPace, settings.units))}
                      {paceUnitLabel(settings.units)}
                    </p>
                  </div>
                )}
              </div>
            )}

          {/* Pace structure visualization */}
          {workout.blocks.length > 0 && (
            <div className="mt-4">
              <PaceChart
                blocks={workout.blocks}
                workoutType={workout.type}
                variant="full"
                color={color}
                useMiles={useMiles}
              />
            </div>
          )}
        </section>

        {!isCompleted && (
          <FuelingCard type={workout.type} durationMinutes={workout.targetDurationMinutes ?? null} />
        )}

        <button
          onClick={() => {
            haptic("medium");
            setWarmupRoutine(isCompleted ? "post-run-mobility" : "dynamic-warmup");
          }}
          className="press flex w-full items-center justify-center gap-2 rounded-[var(--radius-card)] bg-surface py-3.5 text-[14px] font-semibold text-text-1"
        >
          <Sparkles className="h-4 w-4 text-accent-fg" strokeWidth={2.2} />
          {isCompleted ? "Post-run mobility (~4 min)" : "Warm-up first (~5 min)"}
        </button>

        {actionError && (
          <div className="rounded-[var(--radius-card)] bg-danger/10 p-4 text-[13px] text-danger">
            {actionError}
          </div>
        )}

        {/* Details header + Outdoor/Treadmill toggle */}
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-bold text-text-1">Details</h2>
          <Segmented
            options={[
              { value: "outdoor", label: "Outdoor" },
              { value: "treadmill", label: "Treadmill" },
            ]}
            value={mode}
            onChange={setMode}
            className="w-[200px]"
          />
        </div>

        {/* Workout blocks */}
        <section className="k-card p-4 flex flex-col gap-1">
          {workout.blocks.map((block, i) => {
            const isWork = block.type === "work";
            const blockColor = isWork ? color : "var(--k-text-3)";
            const BlockIcon = BLOCK_ICON[block.type] ?? HeartPulse;

            return (
              <div key={i}>
                {/* Block header */}
                <div className="flex items-center gap-3 py-2.5">
                  <BlockIcon className="h-5 w-5 shrink-0" style={{ color: blockColor }} strokeWidth={1.75} />
                  <div className="flex-1">
                    <p className="text-[15px] font-medium text-text-1">
                      {isWork
                        ? BLOCK_LABEL[block.type]
                        : `${BLOCK_LABEL[block.type] ?? block.type}${blockDetail(block, settings.units)}`}
                    </p>
                  </div>
                </div>

                {/* Work block detail */}
                {isWork && (
                  <div className="ml-8 mb-3">
                    <div
                      className="border-l-4 pl-4 py-2 rounded-r-[var(--radius-input)]"
                      style={{ borderLeftColor: color, backgroundColor: "var(--k-elevated)" }}
                    >
                      <p className="text-[15px] font-bold text-text-1">
                        {block.reps && block.repDistanceKm
                          ? `${block.reps}×${Math.round(block.repDistanceKm * 1000)}m`
                          : block.distanceKm
                          ? `${displayDistance(block.distanceKm, 1, settings.units)}${distanceUnitLabel(settings.units)}`
                          : ""
                        }
                        {(() => {
                          const isEasy = workout.type === "easy" || workout.type === "recovery";
                          const isLong = workout.type === "long";
                          const shouldShowPace = showPace && (isEasy ? showEasyPace : isLong ? showLongPace : true);
                          if (useRpe && block.targetPaceSecKm) {
                            return <span className="font-normal text-text-2"> at {ZONE_RPE[block.type] ?? TYPE_RPE[workout.type] ?? "RPE 5-6"}</span>;
                          }
                          if (shouldShowPace && isEasy && block.minPaceSecKm) {
                            // Easy running has a speed CAP, not a target — the
                            // framing: anything slower is on plan.
                            const unit = paceUnitLabel(settings.units);
                            return <span className="font-normal text-text-2">
                              {mode === "treadmill"
                                ? ` — no faster than ${displaySpeed(block.minPaceSecKm, settings.units).toFixed(1)} ${speedUnitLabel(settings.units)}`
                                : ` — no faster than ${formatPace(block.minPaceSecKm, useMiles)}${unit}`
                              }
                            </span>;
                          }
                          if (shouldShowPace && block.targetPaceSecKm) {
                            const unit = paceUnitLabel(settings.units);
                            return <span className="font-normal text-text-2">
                              {mode === "treadmill"
                                ? ` at ${displaySpeed(block.targetPaceSecKm, settings.units).toFixed(1)} ${speedUnitLabel(settings.units)}`
                                : ` at ${formatPace(block.targetPaceSecKm, useMiles)}${unit}`
                              }
                            </span>;
                          }
                          return null;
                        })()}
                      </p>
                      {(() => {
                        const isEasy = workout.type === "easy" || workout.type === "recovery";
                        const isLong = workout.type === "long";
                        const shouldShowPace = showPace && (isEasy ? showEasyPace : isLong ? showLongPace : true) && !useRpe;
                        if (isEasy) return null; // the cap line above says it all
                        if (!shouldShowPace || !block.minPaceSecKm || !block.maxPaceSecKm) return null;
                        const unit = paceUnitLabel(settings.units);
                        return (
                          <p className="text-[13px] text-text-3 mt-0.5">
                            {mode === "treadmill"
                              ? `Speed: ${displaySpeed(block.maxPaceSecKm, settings.units).toFixed(1)} – ${displaySpeed(block.minPaceSecKm, settings.units).toFixed(1)} ${speedUnitLabel(settings.units)}`
                              : `Pace range: ${formatPace(block.minPaceSecKm, useMiles)} – ${formatPace(block.maxPaceSecKm, useMiles)}${unit}`
                            }
                          </p>
                        );
                      })()}
                      {block.repRestSeconds != null && (
                        <p className="text-[13px] text-text-3 mt-0.5">{block.repRestSeconds}s rest between reps</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Dashed divider between blocks */}
                {i < workout.blocks.length - 1 && (
                  <div className="ml-8 border-b border-dashed border-hairline" />
                )}
              </div>
            );
          })}
        </section>

        {/* Coaching tip */}
        <section className="k-card p-4 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/20 mt-0.5">
            <HeartPulse className="h-5 w-5 text-accent-fg" strokeWidth={1.75} />
          </div>
          <div>
            <p className="text-[15px] font-bold text-text-1">Coach tip</p>
            <p className="mt-1 text-[13px] text-text-2 leading-relaxed">
              {getCoachingTip(workout.type, workout.targetKm, maxPace)}
            </p>
          </div>
        </section>

        {/* Skipped banner — stays visible (not hidden/removed) so a skipped
            session still shows up in the plan and in adherence, and the only
            way back is right here since Skip has no other entry point. */}
        {isSkipped && (
          <div className="k-card flex items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-elevated">
                <SkipForward className="h-4 w-4 text-text-2" strokeWidth={2} />
              </span>
              <p className="text-[13px] font-semibold text-text-2">
                Skipped — won&apos;t count as missed
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={handleUnskip}>
              Restore
            </Button>
          </div>
        )}

        {/* Primary action */}
        <div className="pt-1 flex flex-col gap-2.5">
          {isCompleted ? (
            <>
            <div className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-input)] bg-elevated py-4 text-center text-[15px] font-bold text-text-2">
              <CheckCircle2 className="h-4 w-4 text-accent-fg" strokeWidth={2.5} />
              Completed
            </div>
            <div className="k-card p-4">
              <p className="text-[13px] font-semibold text-text-2">
                {workout.rpe != null
                  ? `Effort logged: RPE ${workout.rpe}`
                  : "How hard did it feel? (0 = nothing, 10 = max)"}
              </p>
              <div className="mt-3 grid grid-cols-11 gap-1">
                {Array.from({ length: 11 }, (_, n) => (
                  <button
                    key={n}
                    type="button"
                    disabled={rpeSaving}
                    onClick={() => handleRpe(n)}
                    style={{ touchAction: "manipulation" }}
                    className={`press rounded-md py-2 text-[13px] font-bold ${
                      workout.rpe === n
                        ? "bg-accent text-on-accent"
                        : "bg-elevated text-text-2"
                    } disabled:opacity-50`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            </>
          ) : resumeSnap ? (
            <>
              <Button
                variant="primary"
                full
                size="lg"
                onClick={() => {
                  haptic("medium");
                  setResuming(true);
                  setGuiding(true);
                }}
              >
                <span className="flex items-center justify-center gap-2">
                  <Play className="h-5 w-5" strokeWidth={2.2} fill="currentColor" />
                  Resume run
                </span>
              </Button>
              <Button
                variant="secondary"
                full
                onClick={() => {
                  haptic("light");
                  clearRunSnapshot();
                  setResumeSnap(null);
                }}
              >
                Discard & start over
              </Button>
              <MusicButton />
            </>
          ) : (
            <>
              <Button
                variant="primary"
                full
                size="lg"
                onClick={() => {
                  haptic("medium");
                  setResuming(false);
                  setGuiding(true);
                }}
              >
                <span className="flex items-center justify-center gap-2">
                  <Radio className="h-5 w-5" strokeWidth={2.2} />
                  Start guided run
                </span>
              </Button>
              {/* Race day completes via "Log race result" (three-dot menu) —
                  a plain Mark complete would skip the finish time and never
                  close out the plan, so it's left out here on purpose. */}
              {!isRace && (
                <Button variant="secondary" full busy={completing} onClick={handleComplete}>
                  {completing ? "Saving..." : "Mark complete"}
                </Button>
              )}
              <MusicButton />
            </>
          )}
        </div>
      </div>

      <AnimatePresence>
        {celebrating && (
          <WorkoutCelebration
            detail={celebrationDetail}
            onDone={() => setCelebrating(false)}
          />
        )}
      </AnimatePresence>

      {/* Warm-up / mobility overlay */}
      <AnimatePresence>
        {warmupRoutine && routineById(warmupRoutine) && (
          <WarmupPlayer
            routine={routineById(warmupRoutine)!}
            onClose={() => setWarmupRoutine(null)}
          />
        )}
      </AnimatePresence>

      {/* Guided run overlay */}
      <AnimatePresence>
        {guiding && (
          <GuidedRun
            workoutId={workout.id}
            title={displayWorkoutTitle(workout, settings.units)}
            blocks={workout.blocks}
            useMiles={useMiles}
            resumeFrom={resuming ? resumeSnap : null}
            onFinish={handleGuidedFinish}
            onMinimize={() => {
              setGuiding(false);
              setResuming(false);
              setResumeSnap(loadRunSnapshot());
            }}
            onClose={() => {
              setGuiding(false);
              setResuming(false);
              setResumeSnap(null);
            }}
          />
        )}
      </AnimatePresence>

      {/* Options sheet */}
      <OptionsSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onSkip={handleSkip}
        onUnskip={handleUnskip}
        onEdit={() => setEditOpen(true)}
        onUncomplete={handleUncomplete}
        onLinkActivity={() => setLinkOpen(true)}
        onAddTime={() => setTimeOpen(true)}
        onMove={() => {
          // Rearrange already does drag-to-reschedule with the full week in
          // view — reuse it instead of a second date picker. `workoutId`
          // lets it focus/scroll to this session once it reads the param.
          router.push(`/plan/rearrange?workoutId=${workout.id}`);
        }}
        onLogRaceResult={() => {
          setRaceResultPrefillSeconds(workout.raceFinishSeconds ?? null);
          setRaceResultOpen(true);
        }}
        isCompleted={isCompleted}
        isSkipped={isSkipped}
        isRace={isRace}
      />
      <EditWorkoutSheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        workout={workout}
        onSaved={() => {
          setEditOpen(false);
          loadWorkout();
        }}
      />
      <LinkActivitySheet
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        workout={workout}
        onLinked={() => {
          setLinkOpen(false);
          loadWorkout();
        }}
      />
      <AddTimeSheet
        open={timeOpen}
        onClose={() => setTimeOpen(false)}
        workout={workout}
        onSaved={(timeOfDay) => {
          setTimeOpen(false);
          setWorkout((prev) => (prev ? { ...prev, timeOfDay } : prev));
        }}
      />
      <RaceResultSheet
        open={raceResultOpen}
        onClose={() => setRaceResultOpen(false)}
        initialSeconds={raceResultPrefillSeconds}
        onSubmit={submitRaceResult}
        saving={raceResultSaving}
        error={raceResultError}
      />
    </main>

    {postRace && (
      <PostRaceScreen
        title={displayWorkoutTitle(workout, settings.units)}
        finishSeconds={postRace.finishSeconds}
        distanceKm={postRace.distanceKm}
        feel={postRace.feel}
        units={settings.units}
        planClosed={postRace.planClosed}
        onClose={() => setPostRace(null)}
      />
    )}
    </>
  );
}

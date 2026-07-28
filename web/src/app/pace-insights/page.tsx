"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, CheckCircle2, AlertTriangle, HelpCircle, Plus, TrendingUp, Activity } from "lucide-react";
import { NavBar } from "@/components/ui/NavBar";
import { Segmented } from "@/components/ui/Segmented";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/feedback";
import { apiFetch } from "@/lib/api";
import { displayDistance, distanceUnitLabel, formatDistance } from "@/lib/units";
import { haptic } from "@/lib/haptics";
import { useSwipeBack } from "@/lib/useSwipeBack";

// ── Types ────────────────────────────────────────────────────────────────────

interface SpeedWorkout {
  date: string;
  type: string;
  targetPaceSecKm: number;
  minPaceSecKm: number;
  maxPaceSecKm: number;
  actualAvgPace: number | null;
}

interface LongWorkout {
  date: string;
  targetPaceSecKm: number;
  minPaceSecKm: number;
  maxPaceSecKm: number;
  actualAvgPace: number | null;
}

interface RaceTime {
  id: string;
  distance: string;
  timeSeconds: number;
  date: string | null;
  source: string;
}

interface NextSpeedWorkout {
  date: string;
  dayLabel: string;
  type: string;
  targetKm: number;
  color: string;
}

interface PaceInsightsData {
  activePlan: boolean;
  planName: string;
  vdot: number;
  updatedDate: string;
  paceStatus: PaceStatus;
  statusMessage: string;
  nextSpeedWorkout: NextSpeedWorkout | null;
  paceZones: Record<string, { minPaceSecKm: number; targetPaceSecKm: number; maxPaceSecKm: number }>;
  speedWorkouts: SpeedWorkout[];
  longWorkouts: LongWorkout[];
  raceTimes: RaceTime[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0)
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr);
  return `${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getDate().toString().padStart(2, "0")}`;
}

function formatUpdatedDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1).toString().padStart(2, "0")}`;
}

const workoutTypeColor: Record<string, string> = {
  tempo: "#FFB547",
  interval: "#C084FC",
  long: "#60A5FA",
};

const workoutTypeLabel: Record<string, string> = {
  tempo: "Tempo",
  interval: "Intervals",
  long: "Long Run",
};

// ── Back button ─────────────────────────────────────────────────────────────

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

// ── Status Card ───────────────────────────────────────────────────────────────

type PaceStatus = "on_point" | "ahead" | "review" | "variable" | "no_data";

const VERDICTS: Record<
  Exclude<PaceStatus, "no_data">,
  { title: string; color: string; rgb: string; Icon: typeof CheckCircle2 }
> = {
  on_point: { title: "Pace on Point", color: "#22c55e", rgb: "34,197,94", Icon: CheckCircle2 },
  ahead: { title: "Ahead of the Pack", color: "#60A5FA", rgb: "96,165,250", Icon: TrendingUp },
  review: { title: "Review Your Pace", color: "#FFB547", rgb: "255,181,71", Icon: AlertTriangle },
  variable: { title: "Variable Pace Detected", color: "#C084FC", rgb: "192,132,252", Icon: Activity },
};

function StatusCard({
  paceStatus,
  statusMessage,
}: {
  paceStatus: PaceStatus;
  statusMessage: string;
}) {
  if (paceStatus === "no_data") {
    return (
      <div className="k-card p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-full bg-elevated flex items-center justify-center shrink-0">
            <HelpCircle className="h-5 w-5 text-text-3" strokeWidth={1.75} />
          </div>
          <p className="text-[15px] font-bold text-text-1">No data yet</p>
        </div>
        <p className="text-[13px] text-text-2 leading-relaxed">
          Complete your first speed workout to see pace insights.
        </p>
      </div>
    );
  }

  const v = VERDICTS[paceStatus];

  return (
    <div className="k-card p-4">
      <div className="w-9 h-9 rounded-full bg-elevated flex items-center justify-center mb-4">
        <v.Icon className="h-5 w-5 text-text-2" strokeWidth={1.75} />
      </div>

      <p className="text-[15px] font-bold text-text-1 mb-1">{v.title}</p>
      <p className="text-[13px] text-text-2 leading-relaxed mb-6">{statusMessage}</p>

      <div className="flex items-center justify-center py-4">
        <div className="relative flex items-center justify-center">
          <div
            className="absolute w-28 h-28 rounded-full blur-2xl opacity-30"
            style={{ backgroundColor: v.color }}
          />
          <div
            className="relative w-20 h-20 rounded-full flex items-center justify-center"
            style={{
              backgroundColor: `rgba(${v.rgb},0.12)`,
              border: `2px solid rgba(${v.rgb},0.3)`,
            }}
          >
            <v.Icon className="w-9 h-9" style={{ color: v.color }} strokeWidth={2} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Pace Chart (SVG) ──────────────────────────────────────────────────────────

interface PaceChartWorkout {
  date: string;
  type?: string;
  minPaceSecKm: number;
  maxPaceSecKm: number;
  actualAvgPace: number | null;
}

function PaceInsightChart({ workouts }: { workouts: PaceChartWorkout[] }) {
  if (workouts.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-[13px] text-text-3">
        No pace data yet
      </div>
    );
  }

  const SVG_W = 320;
  const SVG_H = 120;
  const PAD_LEFT = 10;
  const PAD_RIGHT = 10;
  const PAD_TOP = 12;
  const PAD_BOTTOM = 28;
  const chartW = SVG_W - PAD_LEFT - PAD_RIGHT;
  const chartH = SVG_H - PAD_TOP - PAD_BOTTOM;

  const allPaces: number[] = workouts.flatMap((w) => [
    w.minPaceSecKm,
    w.maxPaceSecKm,
    ...(w.actualAvgPace != null ? [w.actualAvgPace] : []),
  ]);
  const globalMin = Math.min(...allPaces) - 20;
  const globalMax = Math.max(...allPaces) + 20;
  const paceRange = globalMax - globalMin;

  function paceToY(pace: number): number {
    return PAD_TOP + ((pace - globalMin) / paceRange) * chartH;
  }

  const n = workouts.length;
  function workoutX(i: number): number {
    if (n === 1) return PAD_LEFT + chartW / 2;
    return PAD_LEFT + (i / (n - 1)) * chartW;
  }

  const zonePaces = workouts.map((w) => ({ min: w.minPaceSecKm, max: w.maxPaceSecKm }));
  const bandMinPace = Math.min(...zonePaces.map((z) => z.min));
  const bandMaxPace = Math.max(...zonePaces.map((z) => z.max));
  const bandTop = paceToY(bandMinPace);
  const bandBottom = paceToY(bandMaxPace);

  return (
    <div className="w-full overflow-hidden">
      <div className="relative">
        <div
          className="absolute left-0 flex flex-col justify-between pointer-events-none"
          style={{ top: PAD_TOP, height: chartH }}
        >
          <span className="text-[10px] text-text-3 leading-none">Faster</span>
          <span className="text-[10px] text-text-3 leading-none">Slower</span>
        </div>

        <svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          className="w-full"
          style={{ height: SVG_H }}
          aria-hidden="true"
        >
          <rect
            x={PAD_LEFT}
            y={bandTop}
            width={chartW}
            height={Math.max(2, bandBottom - bandTop)}
            fill="rgba(255,255,255,0.06)"
            rx={4}
          />
          <rect
            x={PAD_LEFT}
            y={bandTop}
            width={chartW}
            height={Math.max(2, bandBottom - bandTop)}
            fill="none"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth={1}
            rx={4}
          />

          {workouts.map((wo, i) => {
            if (wo.actualAvgPace == null) return null;
            const x = workoutX(i);
            const dotColor = wo.type ? (workoutTypeColor[wo.type] ?? "#9A9A9F") : "#9A9A9F";
            const fastY = paceToY(wo.minPaceSecKm);
            const slowY = paceToY(wo.maxPaceSecKm);
            const avgY = paceToY(wo.actualAvgPace);

            return (
              <g key={i}>
                <line
                  x1={x}
                  y1={fastY}
                  x2={x}
                  y2={slowY}
                  stroke={dotColor}
                  strokeWidth={2}
                  strokeLinecap="round"
                  opacity={0.6}
                />
                <circle cx={x} cy={fastY} r={4} fill={dotColor} />
                <circle cx={x} cy={slowY} r={4} fill={dotColor} />
                <circle cx={x} cy={avgY} r={2.5} fill="white" opacity={0.9} />
              </g>
            );
          })}

          {workouts.map((wo, i) => {
            const x = workoutX(i);
            if (n > 6 && i % 2 !== 0) return null;
            return (
              <text
                key={i}
                x={x}
                y={SVG_H - 4}
                textAnchor="middle"
                fontSize={9}
                fill="var(--k-text-3)"
                fontFamily="Inter, system-ui, sans-serif"
              >
                {formatDateShort(wo.date)}
              </text>
            );
          })}
        </svg>
      </div>

      <div className="flex items-center gap-4 mt-2">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-white/10 border border-white/20" />
          <span className="text-[10px] text-text-3">Target zone</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-text-1" />
          <span className="text-[10px] text-text-3">Fastest/slowest rep pace</span>
        </div>
      </div>
    </div>
  );
}

// ── Expandable Section ────────────────────────────────────────────────────────

function ExpandableSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-hairline pt-3 mt-3">
      <button
        onClick={() => {
          haptic("light");
          setOpen(!open);
        }}
        className="w-full flex items-center justify-between text-left"
        aria-expanded={open}
      >
        <span className="text-[13px] font-semibold text-text-2">{title}</span>
        <ChevronRight
          className={`h-4 w-4 text-text-3 transition-transform ${open ? "rotate-90" : ""}`}
          strokeWidth={2}
        />
      </button>
      {open && (
        <div className="mt-3 text-[13px] text-text-2 leading-relaxed">{children}</div>
      )}
    </div>
  );
}

// ── Race Time Card ────────────────────────────────────────────────────────────

function HexBadge({ label }: { label: string }) {
  return (
    <div className="relative w-10 h-10 flex items-center justify-center shrink-0">
      <svg viewBox="0 0 40 40" className="absolute inset-0 w-full h-full" aria-hidden="true">
        <polygon
          points="20,2 38,11 38,29 20,38 2,29 2,11"
          fill="var(--k-elevated)"
          stroke="var(--k-hairline)"
          strokeWidth="1.5"
        />
      </svg>
      <span className="relative text-[9px] font-bold text-text-1 text-center leading-tight">
        {label}
      </span>
    </div>
  );
}

function distanceCategory(distance: string): "short" | "long" {
  const lower = distance.toLowerCase();
  if (lower.includes("5k") || lower.includes("10k") || lower.includes("5 k") || lower.includes("10 k")) {
    return "short";
  }
  return "long";
}

function RaceTimesSection({
  raceTimes,
  onAddTime,
}: {
  raceTimes: RaceTime[];
  onAddTime: (category: "short" | "long") => void;
}) {
  const shortTime = raceTimes.find((r) => distanceCategory(r.distance) === "short") ?? null;
  const longTime = raceTimes.find((r) => distanceCategory(r.distance) === "long") ?? null;

  return (
    <section>
      <h2 className="text-[17px] font-bold text-text-1 mb-1">Current race times</h2>
      <p className="text-[13px] text-text-2 leading-relaxed mb-4">
        Include a shorter distance and a longer distance time for more accurate paces in your plan.
      </p>

      <div className="flex flex-col gap-3">
        {/* Long distance */}
        {longTime ? (
          <button
            onClick={() => { haptic("light"); onAddTime("long"); }}
            className="press w-full flex items-center gap-3 k-card p-4 text-left"
          >
            <HexBadge label={longTime.distance} />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-text-3">Half/full marathon time</p>
              <p className="text-[15px] font-bold tabular-nums text-text-1 mt-0.5">
                {formatTime(longTime.timeSeconds)}
              </p>
            </div>
            <ChevronRight className="h-5 w-5 text-text-3 shrink-0" strokeWidth={2} />
          </button>
        ) : (
          <button
            onClick={() => { haptic("light"); onAddTime("long"); }}
            className="press w-full flex items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-hairline bg-surface/50 p-4"
          >
            <div className="w-10 h-10 rounded-full bg-elevated flex items-center justify-center shrink-0">
              <Plus className="h-4 w-4 text-text-3" strokeWidth={2} />
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-[13px] font-semibold text-text-2">Add a half/marathon time</p>
              <p className="text-[11px] text-text-3 mt-0.5">Half marathon, marathon</p>
            </div>
          </button>
        )}

        {/* Short distance */}
        {shortTime ? (
          <button
            onClick={() => { haptic("light"); onAddTime("short"); }}
            className="press w-full flex items-center gap-3 k-card p-4 text-left"
          >
            <HexBadge label={shortTime.distance} />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-text-3">Short distance time</p>
              <p className="text-[15px] font-bold tabular-nums text-text-1 mt-0.5">
                {formatTime(shortTime.timeSeconds)}
              </p>
            </div>
            <ChevronRight className="h-5 w-5 text-text-3 shrink-0" strokeWidth={2} />
          </button>
        ) : (
          <button
            onClick={() => { haptic("light"); onAddTime("short"); }}
            className="press w-full flex items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-hairline bg-surface/50 p-4"
          >
            <div className="w-10 h-10 rounded-full bg-elevated flex items-center justify-center shrink-0">
              <Plus className="h-4 w-4 text-text-3" strokeWidth={2} />
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-[13px] font-semibold text-text-2">Add a 5k/10k time</p>
              <p className="text-[11px] text-text-3 mt-0.5">5k, 10k</p>
            </div>
          </button>
        )}
      </div>
    </section>
  );
}

// ── Race time entry sheet ────────────────────────────────────────────────────

const timeInputCls =
  "w-16 rounded-[var(--radius-input)] bg-elevated px-2 py-2.5 text-center text-[16px] font-semibold text-text-1 outline-none tabular-nums focus:ring-2 focus:ring-accent/40";

function RaceTimeSheet({
  open,
  category,
  existing,
  onClose,
  onSaved,
}: {
  open: boolean;
  category: "short" | "long";
  existing: RaceTime | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const options =
    category === "short"
      ? [
          { value: "5k", label: "5K" },
          { value: "10k", label: "10K" },
        ]
      : [
          { value: "half", label: "Half" },
          { value: "marathon", label: "Full" },
        ];

  const [distance, setDistance] = useState(options[0].value);
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the form each time the sheet opens
  useEffect(() => {
    if (!open) return;
    const dist = existing && options.some((o) => o.value === existing.distance)
      ? existing.distance
      : options[0].value;
    const total = existing?.timeSeconds ?? 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reseed form fields when sheet opens
    setDistance(dist);
    setHours(Math.floor(total / 3600));
    setMinutes(Math.floor((total % 3600) / 60));
    setSeconds(total % 60);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, category]);

  async function save() {
    const timeSeconds = hours * 3600 + minutes * 60 + seconds;
    if (timeSeconds <= 0) {
      setError("Enter a time.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/race-times", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ distance, timeSeconds, source: "race" }),
      });
      if (res.ok) {
        haptic("success");
        onSaved();
        onClose();
      } else {
        haptic("warning");
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "Couldn't save the time.");
      }
    } catch {
      setError("Network error. Couldn't save the time.");
    } finally {
      setSaving(false);
    }
  }

  const fields = [
    { key: "h", value: hours, set: setHours, max: 9 },
    { key: "m", value: minutes, set: setMinutes, max: 59 },
    { key: "s", value: seconds, set: setSeconds, max: 59 },
  ];

  return (
    <Sheet open={open} onClose={onClose} title={category === "short" ? "5K / 10K time" : "Half / marathon time"}>
      <div className="flex flex-col gap-4 pb-2">
        <Segmented value={distance} onChange={setDistance} options={options} />
        <div className="flex items-center justify-center gap-2">
          {fields.map(({ key, value, set, max }, i) => (
            <div key={key} className="flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={max}
                value={value}
                onChange={(e) => set(Math.max(0, Math.min(max, parseInt(e.target.value) || 0)))}
                className={timeInputCls}
              />
              {i < 2 && <span className="text-[17px] font-bold text-text-3">:</span>}
            </div>
          ))}
          <span className="ml-1 text-[12px] text-text-3">h : m : s</span>
        </div>
        {error && <p className="text-center text-[13px] text-[#FF4D4D]">{error}</p>}
        <Button full onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save time"}
        </Button>
      </div>
    </Sheet>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function PaceInsightsPage() {
  useSwipeBack();
  const router = useRouter();
  const [data, setData] = useState<PaceInsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"speed" | "long">("speed");
  const [timeSheet, setTimeSheet] = useState<"short" | "long" | null>(null);

  function loadInsights() {
    apiFetch("/api/pace-insights")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load pace insights");
        return r.json();
      })
      .then(setData)
      .catch(() => setError("Couldn't load pace insights. Please try again."))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadInsights, []);

  function handleAddTime(category: "short" | "long") {
    setTimeSheet(category);
  }

  if (loading) {
    return (
      <main className="min-h-dvh bg-bg">
        <NavBar title="Pace Insights" large={false} left={<BackButton />} />
        <div className="px-4 pb-tabbar flex flex-col gap-3 pt-2">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-dvh bg-bg">
        <NavBar title="Pace Insights" large={false} left={<BackButton />} />
        <div className="flex flex-col items-center justify-center gap-3 px-8 py-16 text-center pb-tabbar">
          <p className="text-[15px] text-text-2">{error}</p>
          <Button variant="secondary" onClick={() => router.back()}>Go back</Button>
        </div>
      </main>
    );
  }

  if (!data?.activePlan) {
    return (
      <main className="min-h-dvh bg-bg">
        <NavBar title="Pace Insights" large={false} left={<BackButton />} />
        <div className="flex flex-col items-center justify-center gap-3 px-8 py-16 text-center pb-tabbar">
          <p className="text-[15px] text-text-2">No active plan</p>
          <Button variant="secondary" onClick={() => router.back()}>Go back</Button>
        </div>
      </main>
    );
  }

  const speedWorkouts = data.speedWorkouts ?? [];
  const longWorkouts = data.longWorkouts ?? [];
  const activeWorkouts = activeTab === "speed" ? speedWorkouts : longWorkouts;

  function getSectionDateRange(workouts: Array<{ date: string }>) {
    if (workouts.length === 0) return null;
    const sorted = [...workouts].sort((a, b) => a.date.localeCompare(b.date));
    const first = new Date(sorted[0].date).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const last = new Date(sorted[sorted.length - 1].date).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    if (sorted.length === 1) return first;
    return `${first} – ${last}`;
  }

  const sectionDateRange = getSectionDateRange(activeWorkouts);

  return (
    <main className="min-h-dvh bg-bg">
      <NavBar
        title="Pace Insights"
        large={false}
        left={<BackButton />}
      />

      <div className="px-4 pb-tabbar flex flex-col gap-4 pt-2">
        {/* Title row */}
        <div className="flex items-center justify-between">
          <h1 className="text-[22px] font-bold tracking-tight text-text-1">Pace Insights</h1>
          <div className="flex items-center gap-1.5 text-[11px] text-text-3">
            <CheckCircle2 className="h-3.5 w-3.5 text-accent-fg" strokeWidth={2.5} />
            <span>Updated: {formatUpdatedDate(data.updatedDate)}</span>
          </div>
        </div>

        {/* Status card */}
        <StatusCard paceStatus={data.paceStatus} statusMessage={data.statusMessage} />

        {/* Next speed workout */}
        {data.nextSpeedWorkout && (
          <div>
            <p className="text-[11px] text-text-3 mb-2 font-semibold uppercase tracking-wide">
              Next speed workout:{" "}
              {new Date(data.nextSpeedWorkout.date).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
              })}
            </p>
            <div className="flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-sm shrink-0"
                style={{ backgroundColor: data.nextSpeedWorkout.color }}
              />
              <span className="text-[13px] font-semibold text-text-2">
                {data.nextSpeedWorkout.dayLabel}
              </span>
              <span className="text-text-3">·</span>
              <span className="text-[13px] text-text-2">
                {workoutTypeLabel[data.nextSpeedWorkout.type] ?? data.nextSpeedWorkout.type}
              </span>
              <span className="text-text-3">·</span>
              <span className="text-[13px] text-text-2">{displayDistance(data.nextSpeedWorkout.targetKm)}{distanceUnitLabel()}</span>
            </div>
          </div>
        )}

        {/* Speed / Long tab toggle */}
        <Segmented
          options={[
            { value: "speed", label: "Speed" },
            { value: "long", label: "Long run" },
          ]}
          value={activeTab}
          onChange={setActiveTab}
        />

        {/* Pace on point section */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex-1 min-w-0">
              <h2 className="text-[15px] font-bold text-text-1">
                {activeTab === "speed" ? "Speed run pace" : "Long run pace"}
              </h2>
              {sectionDateRange && (
                <p className="text-[11px] text-text-3 mt-0.5">{sectionDateRange}</p>
              )}
            </div>
          </div>

          {activeWorkouts.length > 0 ? (
            <div className="k-card p-4">
              <PaceInsightChart
                workouts={activeWorkouts.map((wo) => ({
                  date: wo.date,
                  type: "type" in wo ? (wo as SpeedWorkout).type : "long",
                  minPaceSecKm: wo.minPaceSecKm,
                  maxPaceSecKm: wo.maxPaceSecKm,
                  actualAvgPace: wo.actualAvgPace,
                }))}
              />
            </div>
          ) : (
            <div className="k-card p-6 text-center">
              <p className="text-[13px] text-text-3">No pace data yet</p>
              <p className="text-[11px] text-text-3 mt-1">
                {activeTab === "speed"
                  ? "Complete a speed workout to see your pace chart."
                  : "Complete a long run to see your pace chart."}
              </p>
            </div>
          )}
        </section>

        {/* Explanation section */}
        <section className="k-card p-4">
          {activeTab === "speed" ? (
            <div>
              <h2 className="text-[15px] font-bold text-text-1 mb-2">Speed run pace</h2>
              <p className="text-[13px] text-text-2 leading-relaxed">
                We monitor your pace in speed runs to understand how fast you can run over shorter distances.
              </p>
              <ExpandableSection title="Types of speed runs">
                <ul className="flex flex-col gap-2 text-[13px] text-text-2 list-none">
                  <li>
                    <span className="font-semibold" style={{ color: workoutTypeColor.tempo }}>Tempo runs</span>
                    {": "}Sustained effort at a comfortably hard pace, typically 20–40 minutes.
                  </li>
                  <li>
                    <span className="font-semibold" style={{ color: workoutTypeColor.interval }}>Interval runs</span>
                    {": "}Repeated hard efforts with recovery jogs in between to build speed and VO2 max.
                  </li>
                </ul>
              </ExpandableSection>
            </div>
          ) : (
            <div>
              <h2 className="text-[15px] font-bold text-text-1 mb-2">Long run pace</h2>
              <p className="text-[13px] text-text-2 leading-relaxed">
                We monitor your pace in long runs to understand your endurance over longer distances.
              </p>
              <ExpandableSection title="Incompatible runs">
                <p className="text-[13px] text-text-2 leading-relaxed">
                  Runs with GPS signal issues, incomplete recordings, or distances under {formatDistance(10)} are excluded from the long run pace chart to keep the data reliable.
                </p>
              </ExpandableSection>
            </div>
          )}
        </section>

        {/* Race times */}
        <RaceTimesSection raceTimes={data.raceTimes} onAddTime={handleAddTime} />
      </div>

      <RaceTimeSheet
        open={timeSheet !== null}
        category={timeSheet ?? "short"}
        existing={
          timeSheet
            ? data.raceTimes.find((r) => distanceCategory(r.distance) === timeSheet) ?? null
            : null
        }
        onClose={() => setTimeSheet(null)}
        onSaved={loadInsights}
      />
    </main>
  );
}

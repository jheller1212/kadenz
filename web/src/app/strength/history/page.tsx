"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, LineChart, ArrowUp, ArrowDown, PlayCircle, Trophy } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { NavBar } from "@/components/ui/NavBar";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { Skeleton, EmptyState } from "@/components/ui/feedback";
import { VideoSheet } from "@/components/strength/VideoSheet";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { useSwipeBack } from "@/lib/useSwipeBack";
import { useSettings } from "@/lib/useSettings";
import { formatWeightKg, displayWeight, weightUnitLabel } from "@/lib/units";
import { formatRecency } from "@/lib/recency";
import { EXERCISE_BY_SLUG } from "@/lib/strength/program";
import { complaintListLabel, isPainTrackedExercise } from "@/lib/strength/complaint-work";
import { STRENGTH_COMPLAINTS, type Complaint } from "@/lib/strength/types";
import { EQUIPMENT_OPTIONS } from "@/lib/strength/equipment";
import { getVideoId } from "@/lib/strength/videos";
import { strengthHistoryUrl } from "@/lib/routes";

// ── List page types ───────────────────────────────────────────────────────────

interface ListExercise {
  id: string;
  slug: string;
  name: string;
  category: "upper" | "lower" | "achilles";
}
interface ListPoint {
  date: string;
  topWeightKg: number;
  bestE1rm: number;
}
interface ListHistoryResp {
  exercise: ListExercise;
  points: ListPoint[];
  pain: Array<{ date: string; score: number }>;
}

function Sparkline({ points, pain }: { points: ListPoint[]; pain: { date: string; score: number }[] }) {
  const w = 120;
  const h = 44;
  if (points.length === 0) {
    return <div className="h-11 w-[120px] rounded-[var(--radius-input)] bg-elevated" />;
  }
  const vals = points.map((p) => p.topWeightKg);
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);
  const r = mx - mn || 1;
  const denom = points.length - 1 || 1;
  const xy = points.map((p, i) => [6 + (i * (w - 12)) / denom, h - 4 - ((p.topWeightKg - mn) / r) * (h - 10)]);
  const d = xy.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const pdenom = pain.length - 1 || 1;
  const pd = pain.map((p, i) => {
    const x = 6 + (i * (w - 12)) / pdenom;
    const y = h - 4 - (p.score / 10) * (h - 10);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.2" />`;
  });
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0">
      <path
        d={`${d} L ${xy.at(-1)![0].toFixed(1)} ${h} L ${xy[0][0].toFixed(1)} ${h} Z`}
        fill="color-mix(in srgb, var(--color-accent) 14%, transparent)"
      />
      <path d={d} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <g fill="var(--color-danger)" dangerouslySetInnerHTML={{ __html: pd.join("") }} />
    </svg>
  );
}

function StrengthHistoryList() {
  const [items, setItems] = useState<ListHistoryResp[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);

  // The athlete's own complaints decide which exercises carry a pain overlay
  // (see lib/strength/complaint-work.ts) — this screen used to assume Achilles.
  useEffect(() => {
    let alive = true;
    apiFetch("/api/strength/plan-settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (!alive || !s || !Array.isArray(s.complaints)) return;
        setComplaints(
          (s.complaints as string[]).filter((c): c is Complaint =>
            (STRENGTH_COMPLAINTS as readonly string[]).includes(c)
          )
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Single round trip for every exercise's sparkline data (see
  // /api/strength/history/list). Falls back to the old one-request-per-
  // exercise path — /api/strength/exercises, then /api/strength/history/[id]
  // for each — only if the bulk route itself fails, so the screen degrades
  // instead of going blank.
  useEffect(() => {
    (async () => {
      try {
        const listRes = await apiFetch("/api/strength/history/list");
        if (listRes.ok) {
          const results: ListHistoryResp[] = await listRes.json();
          setItems(results.filter((r) => r.points.length > 0));
          return;
        }
        throw new Error("bulk history failed");
      } catch {
        try {
          const exsRes = await apiFetch("/api/strength/exercises");
          const exs: ListExercise[] = exsRes.ok ? await exsRes.json() : [];
          const results = await Promise.all(
            exs.map(async (e) => {
              const r = await apiFetch(`/api/strength/history/${e.id}`);
              return r.ok ? ((await r.json()) as ListHistoryResp) : null;
            })
          );
          setItems(results.filter((r): r is ListHistoryResp => r !== null && r.points.length > 0));
        } catch {
          /* ignore */
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const anyPainTracked = items.some((it) =>
    isPainTrackedExercise(it.exercise.slug, complaints, it.pain.length > 0)
  );

  return (
    <main className="min-h-dvh bg-bg">
      <NavBar
        title="History"
        large={false}
        left={
          <TransitionLink href="/strength" className="flex items-center gap-0.5 text-[17px] text-accent-fg">
            <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
            Kraft
          </TransitionLink>
        }
      />
      <div className="px-4 pb-tabbar">
        <p className="text-[13px] text-text-2">
          Load per exercise over time.
          {complaints.length > 0 ? (
            <>
              {" "}
              <span className="text-danger">Pain scores</span> you log are overlaid on your{" "}
              {complaintListLabel(complaints)} work.
            </>
          ) : anyPainTracked ? (
            <>
              {" "}
              <span className="text-danger">Pain scores</span> you logged are overlaid on the work they relate to.
            </>
          ) : null}
        </p>

        {loading ? (
          <div className="mt-5 space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              icon={<LineChart className="h-10 w-10" strokeWidth={1.5} />}
              title="No sessions yet"
              message="Log a session and your progression will chart here."
            />
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            {items.map((it) => {
              const first = it.points[0]?.topWeightKg ?? 0;
              const last = it.points.at(-1)?.topWeightKg ?? 0;
              const delta = Math.round((last - first) * 10) / 10;
              const col = delta > 0 ? "#4ADE80" : delta < 0 ? "#FF4D4D" : "var(--color-text-2)";
              const painTracked = isPainTrackedExercise(it.exercise.slug, complaints, it.pain.length > 0);
              return (
                <TransitionLink
                  key={it.exercise.id}
                  href={strengthHistoryUrl(it.exercise.id)}
                  className="press flex items-center gap-3 k-card p-3.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-bold text-text-1">{it.exercise.name}</p>
                    <p className="mt-0.5 text-[12px] text-text-3">
                      {it.points.length} sessions · now {displayWeight(last)} {weightUnitLabel()}
                      {painTracked && it.pain.length > 0 ? " · pain tracked" : ""}
                    </p>
                  </div>
                  <Sparkline points={it.points} pain={painTracked ? it.pain : []} />
                  <span className="w-11 shrink-0 text-right text-[13px] font-extrabold tabular-nums" style={{ color: col }}>
                    {delta > 0 ? "+" : ""}
                    {delta}
                  </span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-text-3" strokeWidth={1.9} />
                </TransitionLink>
              );
            })}
          </div>
        )}
      </div>
      <BottomNav active="strength" />
    </main>
  );
}

// ── Detail page (API: /api/strength/history/[exerciseId]) ────────────────────

interface DetailExercise {
  id: string;
  slug: string;
  name: string;
  category: "upper" | "lower" | "achilles" | "full_body";
}
interface SetRow {
  setNumber: number;
  weightKg: number | null;
  reps: number | null;
}
interface PrFlags {
  weight: boolean;
  e1rm: boolean;
  volume: boolean;
}
interface Session {
  sessionId: string;
  date: string;
  type: string;
  title: string;
  sets: SetRow[];
  pr: PrFlags;
}
interface Records {
  topWeightKg: number;
  topWeightReps: number;
  topWeightDate: string | null;
  bestE1rm: number;
  bestE1rmDate: string | null;
  bestVolume: number;
  bestVolumeDate: string | null;
}
interface HistoryResp {
  exercise: DetailExercise;
  bodyweight: boolean;
  points: Array<{ date: string; topWeightKg: number; bestE1rm: number }>;
  sessions: Session[];
  records: Records;
  pain: Array<{ date: string; score: number }>;
}

function topWeight(s: Session): number {
  return Math.max(0, ...s.sets.map((x) => x.weightKg ?? 0));
}

function formatSessionDate(date: string): string {
  return new Date(date).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatAxisDate(date: string): string {
  return new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Group identical consecutive sets into "3 × 10 @ 12 kg" lines. */
function groupSets(sets: SetRow[], unit: "kg" | "lbs"): string[] {
  const lines: string[] = [];
  let i = 0;
  while (i < sets.length) {
    let j = i;
    while (
      j + 1 < sets.length &&
      sets[j + 1].weightKg === sets[i].weightKg &&
      sets[j + 1].reps === sets[i].reps
    ) {
      j++;
    }
    const count = j - i + 1;
    const s = sets[i];
    const load = s.weightKg && s.weightKg > 0 ? formatWeightKg(s.weightKg, unit) : "bodyweight";
    lines.push(`${count} × ${s.reps ?? 0} @ ${load}`);
    i = j + 1;
  }
  return lines;
}

// ── Progression chart (top-set weight per session) ───────────────────────────

function ProgressionChart({
  sessions,
  unit,
}: {
  sessions: Session[];
  unit: "kg" | "lbs";
}) {
  const w = 320;
  const h = 130;
  const padX = 8;
  const padTop = 10;
  const padBottom = 8;

  const vals = sessions.map((s) => topWeight(s));
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);
  const r = mx - mn || 1;
  const denom = sessions.length - 1 || 1;
  const xy = vals.map((v, i) => [
    padX + (i * (w - padX * 2)) / denom,
    h - padBottom - ((v - mn) / r) * (h - padTop - padBottom),
  ]);
  const d = xy.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");

  const first = sessions[0];
  const mid = sessions.length > 2 ? sessions[Math.floor((sessions.length - 1) / 2)] : null;
  const last = sessions.length > 1 ? sessions[sessions.length - 1] : null;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-text-3">
          Top-set weight
        </p>
        <p className="text-[11px] tabular-nums text-text-3">
          {displayWeight(mn, unit)}–{displayWeight(mx, unit)} {weightUnitLabel(unit)}
        </p>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-auto w-full" aria-hidden="true">
        <path
          d={`${d} L ${xy.at(-1)![0].toFixed(1)} ${h} L ${xy[0][0].toFixed(1)} ${h} Z`}
          fill="color-mix(in srgb, var(--color-accent) 14%, transparent)"
        />
        <path
          d={d}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {xy.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r={sessions.length > 24 ? 1.6 : 2.6} fill="var(--color-accent)" />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-text-3">
        <span>{formatAxisDate(first.date)}</span>
        {mid ? <span>{formatAxisDate(mid.date)}</span> : null}
        {last ? <span>{formatAxisDate(last.date)}</span> : null}
      </div>
    </div>
  );
}

// ── Back button ──────────────────────────────────────────────────────────────

function DetailBackButton() {
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
      <span className="text-[17px]">History</span>
    </button>
  );
}

function ExerciseHistoryDetail({ exerciseId }: { exerciseId: string }) {
  useSwipeBack();
  const settings = useSettings();
  const unit = settings.weightUnit;

  const [data, setData] = useState<HistoryResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [videoSlug, setVideoSlug] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await apiFetch(`/api/strength/history/${exerciseId}`);
        if (r.ok) setData((await r.json()) as HistoryResp);
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
  }, [exerciseId]);

  const sessions = data?.sessions ?? [];
  const newestFirst = [...sessions].reverse();
  const meta = data ? EXERCISE_BY_SLUG[data.exercise.slug] : undefined;
  const equipmentLabels = (meta?.equipment ?? [])
    .map((k) => EQUIPMENT_OPTIONS.find((o) => o.key === k)?.label ?? k)
    .join(" · ");

  const records = data?.records;
  const bodyweight = data?.bodyweight ?? false;
  const lastDate = sessions.at(-1)?.date;
  const videoId = data ? getVideoId(data.exercise.slug) : null;

  return (
    <main className="min-h-dvh bg-bg">
      <NavBar title={data?.exercise.name ?? "Exercise"} large={false} left={<DetailBackButton />} />

      <div className="px-4 pb-10 pt-1">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !data || sessions.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              icon={<LineChart className="h-10 w-10" strokeWidth={1.5} />}
              title="No sessions yet"
              message="Complete this exercise in a session and its history will show here."
            />
          </div>
        ) : (
          <>
            {/* Header: muscle tag + equipment */}
            <div className="flex flex-wrap items-center gap-2">
              {meta?.primaryMuscle && (
                <span className="rounded-full bg-elevated px-2.5 py-1 text-[12px] font-bold text-accent-fg">
                  {meta.primaryMuscle}
                </span>
              )}
              {equipmentLabels && (
                <span className="text-[12px] text-text-3">{equipmentLabels}</span>
              )}
            </div>

            {/* Summary stats. Bodyweight exercises have no external load, so
                "Best" and "Best vol." read in reps instead of kg (see
                lib/strength/pr.ts). */}
            <div className="mt-3 grid grid-cols-4 gap-2">
              {[
                {
                  label: "Best",
                  value: bodyweight
                    ? records && records.topWeightReps > 0
                      ? `${records.topWeightReps} reps`
                      : "—"
                    : formatWeightKg(records && records.topWeightKg > 0 ? records.topWeightKg : null, unit),
                },
                {
                  label: "Best vol.",
                  value: bodyweight
                    ? records && records.bestVolume > 0
                      ? `${records.bestVolume} reps`
                      : "—"
                    : records && records.bestVolume > 0
                      ? formatWeightKg(Math.round(records.bestVolume), unit)
                      : "—",
                },
                { label: "Sessions", value: String(sessions.length) },
                { label: "Last", value: lastDate ? formatRecency(lastDate) : "—" },
              ].map((s) => (
                <div key={s.label} className="k-card px-2 py-2.5 text-center">
                  <p className="truncate text-[13px] font-extrabold tabular-nums text-text-1">
                    {s.value}
                  </p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-wide text-text-3">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Progression chart */}
            <section className="k-card mt-3 p-4">
              <ProgressionChart sessions={sessions} unit={unit} />
            </section>

            {/* Demo video */}
            {videoId && (
              <button
                type="button"
                onClick={() => {
                  haptic("light");
                  setVideoSlug(data.exercise.slug);
                }}
                className="press k-card mt-3 flex w-full items-center gap-3 p-3.5"
              >
                <PlayCircle className="h-5 w-5 shrink-0 text-accent-fg" strokeWidth={2} />
                <span className="text-[15px] font-bold text-text-1">Watch demo</span>
                <span className="ml-auto text-[13px] text-text-3">Form video</span>
              </button>
            )}

            {/* Session history */}
            <p className="mt-6 text-[13px] font-semibold uppercase tracking-wide text-text-3">
              Sessions
            </p>
            <div className="mt-2 space-y-3">
              {newestFirst.map((s, idx) => {
                const prev = newestFirst[idx + 1];
                const delta = prev
                  ? Math.round((topWeight(s) - topWeight(prev)) * 10) / 10
                  : 0;
                const lines = groupSets(s.sets, unit);
                const isPr = s.pr.weight || s.pr.e1rm || s.pr.volume;
                return (
                  <div key={s.sessionId} className="k-card p-3.5">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="text-[14px] font-bold text-text-1">
                            {formatSessionDate(s.date)}
                          </p>
                          {isPr && (
                            <span
                              className="flex shrink-0 items-center gap-0.5 rounded-full bg-elevated px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-accent-fg"
                              title="Personal record"
                            >
                              <Trophy className="h-3 w-3" strokeWidth={2.4} />
                              PR
                            </span>
                          )}
                        </div>
                        {s.title && (
                          <p className="mt-0.5 truncate text-[12px] text-text-3">{s.title}</p>
                        )}
                      </div>
                      {prev && delta !== 0 && (
                        <span
                          className="flex shrink-0 items-center gap-0.5 text-[13px] font-extrabold tabular-nums"
                          style={{ color: delta > 0 ? "#4ADE80" : "#FF4D4D" }}
                        >
                          {delta > 0 ? (
                            <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.5} />
                          ) : (
                            <ArrowDown className="h-3.5 w-3.5" strokeWidth={2.5} />
                          )}
                          {Math.abs(displayWeight(Math.abs(delta), unit))} {weightUnitLabel(unit)}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 space-y-0.5">
                      {lines.map((line, i) => (
                        <p key={i} className="text-[13px] tabular-nums text-text-2">
                          {line}
                        </p>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <VideoSheet
        slug={videoSlug}
        title={data?.exercise.name}
        onClose={() => setVideoSlug(null)}
      />
    </main>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
// One route, two views: the exercise list at /strength/history, and a single
// exercise's history at /strength/history?exerciseId=<id>. Both need
// useSearchParams(), which requires a Suspense boundary in a
// prerendered/exported build.

export default function StrengthHistoryPage() {
  return (
    <Suspense fallback={<Skeleton className="m-4 h-40" />}>
      <StrengthHistoryPageInner />
    </Suspense>
  );
}

function StrengthHistoryPageInner() {
  const searchParams = useSearchParams();
  const exerciseId = searchParams.get("exerciseId");
  if (exerciseId) return <ExerciseHistoryDetail exerciseId={exerciseId} />;
  return <StrengthHistoryList />;
}

"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, LineChart } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { NavBar } from "@/components/ui/NavBar";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { Skeleton, EmptyState } from "@/components/ui/feedback";
import { apiFetch } from "@/lib/api";
import { displayWeight, weightUnitLabel } from "@/lib/units";

interface Exercise {
  id: string;
  slug: string;
  name: string;
  category: "upper" | "lower" | "achilles";
}
interface Point {
  date: string;
  topWeightKg: number;
  bestE1rm: number;
}
interface HistoryResp {
  exercise: Exercise;
  points: Point[];
  pain: Array<{ date: string; score: number }>;
}

function Sparkline({ points, pain }: { points: Point[]; pain: { date: string; score: number }[] }) {
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

export default function StrengthHistoryPage() {
  const [items, setItems] = useState<HistoryResp[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const exsRes = await apiFetch("/api/strength/exercises");
        const exs: Exercise[] = exsRes.ok ? await exsRes.json() : [];
        const results = await Promise.all(
          exs.map(async (e) => {
            const r = await apiFetch(`/api/strength/history/${e.id}`);
            return r.ok ? ((await r.json()) as HistoryResp) : null;
          })
        );
        setItems(results.filter((r): r is HistoryResp => r !== null && r.points.length > 0));
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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
          Load per exercise over time. Achilles lifts overlay <span className="text-danger">pain scores</span> on the load
          curve.
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
              return (
                <TransitionLink
                  key={it.exercise.id}
                  href={`/strength/history/${it.exercise.id}`}
                  className="press flex items-center gap-3 k-card p-3.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-bold text-text-1">{it.exercise.name}</p>
                    <p className="mt-0.5 text-[12px] text-text-3">
                      {it.points.length} sessions · now {displayWeight(last)} {weightUnitLabel()}
                      {it.exercise.category === "achilles" && it.pain.length > 0 ? " · pain tracked" : ""}
                    </p>
                  </div>
                  <Sparkline points={it.points} pain={it.exercise.category === "achilles" ? it.pain : []} />
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

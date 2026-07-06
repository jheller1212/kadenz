"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BottomNav } from "@/components/BottomNav";

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
    return <div className="h-11 w-[120px] rounded bg-elevated" />;
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
      <path d={`${d} L ${xy.at(-1)![0].toFixed(1)} ${h} L ${xy[0][0].toFixed(1)} ${h} Z`} fill="color-mix(in srgb, var(--color-accent) 14%, transparent)" />
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
        const exs: Exercise[] = await (await fetch("/api/strength/exercises")).json();
        const results = await Promise.all(
          exs.map(async (e) => {
            const r = await fetch(`/api/strength/history/${e.id}`);
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
    <div className="min-h-screen bg-bg">
      <main className="mx-auto w-full max-w-md px-4 pt-10 pb-28">
        <Link href="/strength" className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-text-2">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Kraft
        </Link>
        <p className="text-xs font-semibold uppercase tracking-widest text-text-3">Trends</p>
        <h1 className="mt-1 text-2xl font-extrabold text-text-1">History</h1>
        <p className="mt-2 text-sm text-text-2">
          Load per exercise over time. Achilles lifts overlay <span className="text-danger">pain scores</span> on the load curve.
        </p>

        {loading ? (
          <div className="mt-6 space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-[var(--radius-card)] bg-surface" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="mt-8 rounded-[var(--radius-card)] border border-hairline bg-surface p-6 text-center">
            <p className="text-sm text-text-2">No completed sessions yet. Log a session and your progression will chart here.</p>
          </div>
        ) : (
          <div className="mt-5 overflow-hidden rounded-[var(--radius-card)] border border-hairline bg-surface">
            {items.map((it) => {
              const first = it.points[0]?.topWeightKg ?? 0;
              const last = it.points.at(-1)?.topWeightKg ?? 0;
              const delta = Math.round((last - first) * 10) / 10;
              const col = delta > 0 ? "#4ADE80" : delta < 0 ? "#FF4D4D" : "var(--color-text-2)";
              return (
                <div key={it.exercise.id} className="flex items-center gap-3 border-b border-hairline px-3.5 py-3 last:border-b-0">
                  <div className="flex-1">
                    <p className="text-[13.5px] font-bold text-text-1">{it.exercise.name}</p>
                    <p className="mt-0.5 text-[11px] text-text-3">
                      {it.points.length} sessions · now {last} kg
                      {it.exercise.category === "achilles" && it.pain.length > 0 ? " · pain tracked" : ""}
                    </p>
                  </div>
                  <Sparkline points={it.points} pain={it.exercise.category === "achilles" ? it.pain : []} />
                  <span className="w-11 text-right text-xs font-extrabold tabular-nums" style={{ color: col }}>
                    {delta > 0 ? "+" : ""}
                    {delta}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </main>
      <BottomNav active="strength" />
    </div>
  );
}

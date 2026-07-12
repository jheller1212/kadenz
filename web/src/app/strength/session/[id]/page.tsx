"use client";

import { use, useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { NavBar } from "@/components/ui/NavBar";
import { Skeleton, EmptyState } from "@/components/ui/feedback";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { apiFetch } from "@/lib/api";
import { useSwipeBack } from "@/lib/useSwipeBack";

// ── Read-only summary of a logged strength session (from the Activities feed) ─

interface SetRow {
  id: string;
  exerciseId: string;
  setNumber: number;
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
}

interface SessionDetail {
  id: string;
  type: string;
  title: string;
  status: string;
  date: string;
  durationMinutes: number | null;
  sets: SetRow[];
}

interface CatalogRow {
  id: string;
  name: string;
}

export default function StrengthSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  useSwipeBack();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([
      apiFetch(`/api/strength/sessions/${id}`).then((r) => (r.ok ? r.json() : null)),
      apiFetch("/api/strength/exercises").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([detail, catalog]: [SessionDetail | null, CatalogRow[]]) => {
        if (!alive) return;
        setSession(detail);
        setNames(Object.fromEntries(catalog.map((c) => [c.id, c.name])));
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id]);

  const bySlot = new Map<string, SetRow[]>();
  for (const s of session?.sets ?? []) {
    const list = bySlot.get(s.exerciseId) ?? [];
    list.push(s);
    bySlot.set(s.exerciseId, list);
  }

  const dateLabel = session
    ? new Date(session.date).toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "short",
      })
    : "";

  return (
    <main className="min-h-dvh bg-bg">
      <NavBar
        title={session?.title ?? "Session"}
        left={
          <TransitionLink href="/activities" aria-label="Back" className="press -ml-2 flex h-9 w-9 items-center justify-center">
            <ChevronLeft className="h-6 w-6 text-text-1" strokeWidth={2} />
          </TransitionLink>
        }
      />
      <div className="flex flex-col gap-4 px-5 pb-tabbar pt-2">
        {loading ? (
          <>
            <Skeleton className="h-20" />
            <Skeleton className="h-40" />
          </>
        ) : !session ? (
          <EmptyState title="Session not found" message="It may have been deleted." />
        ) : (
          <>
            <div className="k-card p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-3">
                {dateLabel}
              </p>
              <div className="mt-2 flex items-center gap-6">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-text-3">Duration</p>
                  <p className="text-[17px] font-bold tabular-nums text-text-1">
                    {session.durationMinutes != null ? `${session.durationMinutes} min` : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-text-3">Sets logged</p>
                  <p className="text-[17px] font-bold tabular-nums text-text-1">{session.sets.length}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-text-3">Status</p>
                  <p className="text-[17px] font-bold capitalize text-text-1">{session.status}</p>
                </div>
              </div>
            </div>

            {bySlot.size === 0 ? (
              <EmptyState title="No sets logged" message="This session has no recorded sets." />
            ) : (
              [...bySlot.entries()].map(([exerciseId, sets]) => (
                <div key={exerciseId} className="k-card p-4">
                  <p className="text-[15px] font-bold text-text-1">
                    {names[exerciseId] ?? "Exercise"}
                  </p>
                  <div className="mt-2 flex flex-col gap-1.5">
                    {sets
                      .sort((a, b) => a.setNumber - b.setNumber)
                      .map((s) => (
                        <div key={s.id} className="flex items-center justify-between text-[14px]">
                          <span className="text-text-3">Set {s.setNumber}</span>
                          <span className="font-semibold tabular-nums text-text-1">
                            {s.weightKg != null ? `${s.weightKg} kg` : "BW"} × {s.reps ?? "—"}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </main>
  );
}

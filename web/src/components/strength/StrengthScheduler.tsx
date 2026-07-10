"use client";

import { useCallback, useEffect, useState } from "react";
import { Dumbbell, Plus, X, AlertTriangle, Trash2, CalendarClock } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";

// ── Types ─────────────────────────────────────────────────────────────────────

type SessionType = "upper" | "lower" | "lower_achilles";

interface StrengthSession {
  id: string;
  date: string;
  type: SessionType;
  title: string;
  status: string;
}

interface Violation {
  code: string;
  severity: "error" | "warn";
  message: string;
}

interface Props {
  /** Monday of the displayed week. */
  weekStart: Date;
  /** This week's runs, for at-a-glance context (validation is server-side). */
  runs: { date: Date; type: string }[];
}

const TYPE_META: Record<SessionType, { label: string; short: string; color: string }> = {
  upper: { label: "Upper", short: "Upper", color: "#60A5FA" },
  lower: { label: "Lower", short: "Lower", color: "#C084FC" },
  lower_achilles: { label: "Lower + Achilles", short: "L+Achilles", color: "#FFB547" },
};

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
const RUN_COLOR: Record<string, string> = {
  easy: "#4ADE80",
  recovery: "#4ADE80",
  long: "#60A5FA",
  tempo: "#FFB547",
  interval: "#C084FC",
  race: "#FF4D4D",
};

// ── Component ─────────────────────────────────────────────────────────────────

export function StrengthScheduler({ weekStart, runs }: Props) {
  const weekStartMs = weekStart.getTime();
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekEnd = addDays(weekStart, 6);

  const [sessions, setSessions] = useState<StrengthSession[]>([]);
  const [loading, setLoading] = useState(true);

  // Add / move sheet
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dayIdx, setDayIdx] = useState(0);
  const [type, setType] = useState<SessionType>("lower_achilles");
  const [violations, setViolations] = useState<Violation[]>([]);
  const [busy, setBusy] = useState(false);

  const fetchSessions = useCallback(async () => {
    const from = new Date(weekStart);
    from.setHours(0, 0, 0, 0);
    const to = new Date(weekEnd);
    to.setHours(23, 59, 59, 999);
    const res = await apiFetch(
      `/api/strength/sessions?from=${from.toISOString()}&to=${to.toISOString()}`
    );
    return res.ok ? ((await res.json()) as StrengthSession[]) : null;
  }, [weekStartMs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load on mount / week change — setState only after the await, per the
  // codebase's effect convention.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await fetchSessions().catch(() => null);
      if (cancelled) return;
      if (rows) setSessions(rows);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchSessions]);

  // Manual refresh (from event handlers — allowed to setState).
  const load = useCallback(async () => {
    const rows = await fetchSessions().catch(() => null);
    if (rows) setSessions(rows);
  }, [fetchSessions]);

  const sessionOn = (d: Date) => sessions.find((s) => sameDay(new Date(s.date), d));

  // Re-validate whenever the chosen day/type changes while the sheet is open.
  useEffect(() => {
    if (!sheetOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/strength/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type,
            date: days[dayIdx].toISOString(),
            excludeSessionId: editingId ?? undefined,
          }),
        });
        if (res.ok && !cancelled) {
          const data = await res.json();
          setViolations(data.violations ?? []);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sheetOpen, dayIdx, type, editingId]); // eslint-disable-line react-hooks/exhaustive-deps

  function openAdd(idx: number) {
    haptic("light");
    setEditingId(null);
    setDayIdx(idx);
    setType("lower_achilles");
    setViolations([]);
    setSheetOpen(true);
  }

  function openMove(s: StrengthSession) {
    haptic("light");
    setEditingId(s.id);
    setType(s.type);
    const idx = days.findIndex((d) => sameDay(d, new Date(s.date)));
    setDayIdx(idx >= 0 ? idx : 0);
    setViolations([]);
    setSheetOpen(true);
  }

  const hasError = violations.some((v) => v.severity === "error");

  async function confirm() {
    setBusy(true);
    try {
      const date = days[dayIdx].toISOString();
      const res = editingId
        ? await apiFetch(`/api/strength/sessions/${editingId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date }),
          })
        : await apiFetch("/api/strength/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type, date, force: true }),
          });
      if (res.ok) {
        haptic("success");
        setSheetOpen(false);
        await load();
      } else {
        haptic("warning");
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    haptic("medium");
    setBusy(true);
    try {
      const res = await apiFetch(`/api/strength/sessions/${id}`, { method: "DELETE" });
      if (res.ok) await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-2 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Dumbbell className="h-4 w-4 text-text-2" strokeWidth={2} />
        <h2 className="text-[15px] font-bold text-text-1">Strength this week</h2>
        <span className="ml-auto text-[12px] text-text-3 tabular-nums">
          {sessions.length} scheduled
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {days.map((d, i) => {
          const s = sessionOn(d);
          const dayRuns = runs.filter((r) => sameDay(r.date, d));
          const isToday = sameDay(d, new Date());
          return (
            <div
              key={i}
              className={`flex items-center gap-3 rounded-[var(--radius-input)] px-3 py-2.5 ${
                isToday ? "bg-accent/5 ring-1 ring-accent/30" : "bg-surface"
              }`}
            >
              <div className="w-9 shrink-0 text-center">
                <p className="text-[10px] font-bold uppercase tracking-wide text-text-3">{DOW[i]}</p>
                <p className="text-[15px] font-bold text-text-1 tabular-nums">{d.getDate()}</p>
              </div>

              {/* run dots for context */}
              <div className="flex w-10 shrink-0 items-center gap-1">
                {dayRuns.map((r, ri) => (
                  <span
                    key={ri}
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: RUN_COLOR[r.type] ?? "#5C5C61" }}
                    title={r.type}
                  />
                ))}
              </div>

              {s ? (
                <button
                  onClick={() => openMove(s)}
                  className="press flex min-w-0 flex-1 items-center gap-2 rounded-full px-3 py-1.5 text-left"
                  style={{ backgroundColor: `${TYPE_META[s.type].color}22` }}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: TYPE_META[s.type].color }}
                  />
                  <span className="truncate text-[13px] font-semibold text-text-1">
                    {TYPE_META[s.type].label}
                  </span>
                  {s.status === "completed" && (
                    <span
                      className="ml-auto text-[10px] font-bold uppercase"
                      style={{ color: "#4ADE80" }}
                    >
                      done
                    </span>
                  )}
                </button>
              ) : (
                <button
                  onClick={() => openAdd(i)}
                  className="press flex flex-1 items-center gap-1.5 rounded-full border border-dashed border-hairline px-3 py-1.5 text-[13px] font-medium text-text-3"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
                  Add strength
                </button>
              )}

              {s && (
                <button
                  onClick={() => remove(s.id)}
                  disabled={busy}
                  aria-label="Remove strength session"
                  className="press flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-3 disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={2} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {loading && <p className="text-center text-[12px] text-text-3">Loading…</p>}

      {/* Add / move sheet */}
      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={editingId ? "Move session" : "Add strength"}>
        <div className="flex flex-col gap-4 px-1 pb-2">
          {!editingId && (
            <div>
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-text-3">Session</p>
              <Segmented
                value={type}
                onChange={(v) => setType(v as SessionType)}
                options={[
                  { value: "upper", label: "Upper" },
                  { value: "lower", label: "Lower" },
                  { value: "lower_achilles", label: "L+Achilles" },
                ]}
              />
            </div>
          )}

          <div>
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-text-3">Day</p>
            <div className="grid grid-cols-7 gap-1.5">
              {days.map((d, i) => {
                const active = i === dayIdx;
                const taken = !!sessionOn(d) && sessionOn(d)!.id !== editingId;
                return (
                  <button
                    key={i}
                    disabled={taken}
                    onClick={() => {
                      haptic("light");
                      setDayIdx(i);
                    }}
                    className={`flex flex-col items-center rounded-[var(--radius-input)] py-2 text-center transition-colors disabled:opacity-30 ${
                      active ? "bg-accent text-on-accent" : "bg-elevated text-text-2"
                    }`}
                  >
                    <span className="text-[9px] font-bold uppercase">{DOW[i]}</span>
                    <span className="text-[14px] font-bold tabular-nums">{d.getDate()}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Constraint feedback */}
          {violations.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {violations.map((v, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-2 rounded-[var(--radius-input)] px-3 py-2 text-[12.5px] ${
                    v.severity === "error" ? "bg-danger/10 text-danger" : "bg-warn/10 text-warn"
                  }`}
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
                  <span>{v.message}</span>
                </div>
              ))}
            </div>
          ) : (
            <div
              className="flex items-center gap-2 rounded-[var(--radius-input)] px-3 py-2 text-[12.5px]"
              style={{ backgroundColor: "rgba(74,222,128,0.10)", color: "#4ADE80" }}
            >
              <CalendarClock className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
              <span>No conflicts with your runs this week.</span>
            </div>
          )}

          <Button full onClick={confirm} busy={busy} variant={hasError ? "danger" : "primary"}>
            {hasError
              ? editingId
                ? "Move anyway"
                : "Schedule anyway"
              : editingId
                ? "Move session"
                : "Schedule session"}
          </Button>
          <button
            onClick={() => setSheetOpen(false)}
            className="press mx-auto flex items-center gap-1 text-[13px] font-medium text-text-3"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
            Cancel
          </button>
        </div>
      </Sheet>
    </section>
  );
}

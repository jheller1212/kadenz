"use client";

import { useState } from "react";
import { CalendarDays, Dumbbell } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { runPlanPresence, strengthPlanPresence } from "@/lib/plan-presence";

// ── The two plans, on the tab called Plan ────────────────────────────────────
//
// Kadenz runs two independent plans — a running plan and Kraft — and until now
// this tab only really acknowledged one. It rendered the running plan's weeks,
// dropped to "Build your plan" the moment that plan ended, and left managing
// either of them behind a quick-action labelled "Manage Plan", singular, which
// reads as the running one.
//
// The consequence was not just untidy. An athlete whose running plan was
// cancelled saw a screen inviting them to create a race plan while Kraft was
// still scheduling sessions and pushing them to their watch, with no way from
// here to see that, let alone stop it.
//
// So both plans are named here, both say whether they are on, and both can be
// added or removed without leaving the tab.

export interface PlansOverviewProps {
  runPlan: { id: string; name: string; planLengthWeeks: number } | null;
  strengthPlan: { active: boolean; sessionsPerWeek: number } | null;
  /** Re-fetch the page's data after a change. */
  onChanged: () => void;
}

type Removing = "run" | "strength" | null;

export function PlansOverview({ runPlan, strengthPlan, onChanged }: PlansOverviewProps) {
  const [confirm, setConfirm] = useState<Removing>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Branches live in lib/plan-presence.ts, tested there.
  const runState = runPlanPresence(runPlan);
  const kraftState = strengthPlanPresence(strengthPlan);
  const kraftOn = kraftState === "active";

  async function remove(which: Exclude<Removing, null>) {
    setBusy(true);
    setError(null);
    try {
      const res =
        which === "run"
          ? await apiFetch(`/api/plans/${runPlan!.id}`, { method: "DELETE" })
          : await apiFetch("/api/strength/plan-settings", { method: "DELETE" });
      if (!res.ok) throw new Error("remove failed");
      setConfirm(null);
      onChanged();
    } catch {
      // Left on screen rather than silently reverted: the removal reaches the
      // calendar and the watch, so "did that work?" is a fair question to be
      // able to answer.
      setError("Couldn't remove that plan. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <p className="text-[13px] font-semibold uppercase tracking-wide text-text-3">Your plans</p>

      {/* Running */}
      <div className="k-card flex items-center gap-3 p-3.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-elevated">
          <CalendarDays className="h-4 w-4 text-text-2" strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium text-text-1">Running</p>
          <p className="truncate text-[13px] text-text-3">
            {runState === "active" ? `${runPlan!.name} · ${runPlan!.planLengthWeeks} weeks` : "No plan"}
          </p>
        </div>
        {runState === "active" ? (
          <button
            onClick={() => {
              haptic("medium");
              setConfirm("run");
            }}
            className="press shrink-0 rounded-full bg-elevated px-3 py-1.5 text-[13px] font-semibold text-danger"
          >
            Remove
          </button>
        ) : (
          <TransitionLink href="/create">
            <Button variant="primary" size="sm">Add</Button>
          </TransitionLink>
        )}
      </div>

      {/* Kraft */}
      <div className="k-card flex items-center gap-3 p-3.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-elevated">
          <Dumbbell className="h-4 w-4 text-text-2" strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium text-text-1">Kraft</p>
          <p className="truncate text-[13px] text-text-3">
            {kraftState === "active"
              ? `${strengthPlan!.sessionsPerWeek}× a week`
              : kraftState === "stopped"
                ? "Stopped"
                : "No plan"}
          </p>
        </div>
        {kraftOn ? (
          <button
            onClick={() => {
              haptic("medium");
              setConfirm("strength");
            }}
            className="press shrink-0 rounded-full bg-elevated px-3 py-1.5 text-[13px] font-semibold text-danger"
          >
            Remove
          </button>
        ) : (
          <TransitionLink href="/strength/setup">
            <Button variant="primary" size="sm">Add</Button>
          </TransitionLink>
        )}
      </div>

      {error && <p className="px-1 text-[13px] font-medium text-danger">{error}</p>}

      {/* One sheet for both, because the consequence is the same sentence
          either way — and it is the sentence that was missing before: the
          events and watch workouts go too. */}
      <Sheet
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === "run" ? "Remove running plan?" : "Remove Kraft plan?"}
      >
        <div className="flex flex-col gap-4 px-4 pb-6">
          <p className="text-[14px] leading-relaxed text-text-2">
            Upcoming {confirm === "run" ? "workouts" : "strength sessions"} are removed, along
            with their calendar events and the workouts already sent to your watch.
          </p>
          <p className="text-[14px] leading-relaxed text-text-2">
            Everything you have already done stays — completed sessions and their history are
            not touched.
          </p>
          <Button
            variant="primary"
            size="lg"
            full
            disabled={busy}
            onClick={() => confirm && remove(confirm)}
          >
            {busy ? "Removing…" : confirm === "run" ? "Remove running plan" : "Remove Kraft plan"}
          </Button>
          <Button variant="secondary" size="lg" full onClick={() => setConfirm(null)}>
            Keep it
          </Button>
        </div>
      </Sheet>
    </section>
  );
}

"use client";

import { Repeat } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { EmptyState } from "@/components/ui/feedback";
import { haptic } from "@/lib/haptics";
import { findExchangeCandidates } from "@/lib/strength/exchange";
import type { Equipment } from "@/lib/strength/types";

interface Props {
  open: boolean;
  onClose: () => void;
  /** The exercise this sheet is acting on. */
  exercise: { slug: string; name: string } | null;
  /** Every other exercise slug already in this session (excluded as candidates). */
  otherSlugsInSession: string[];
  equipment: Equipment[] | null;
  /** This exercise already has logged sets this session — block Exchange. */
  hasLoggedSets: boolean;
  onExchange: (replacementSlug: string) => void;
}

// Exchange candidates for one exercise. Remove lives as its own 44×44 icon
// button next to this one on every exercise row (see the pre-workout list,
// the session detail screen and the guided session) — a direct action, not
// buried in this sheet, per the Volt session-start spec.
export function ExerciseActionsSheet({
  open,
  onClose,
  exercise,
  otherSlugsInSession,
  equipment,
  hasLoggedSets,
  onExchange,
}: Props) {
  const candidates = exercise
    ? findExchangeCandidates(exercise.slug, otherSlugsInSession, equipment)
    : [];

  return (
    <Sheet open={open} onClose={onClose} title={exercise ? `Exchange ${exercise.name}` : "Exchange"}>
      <div className="flex flex-col gap-3 px-4 pb-6">
        {hasLoggedSets ? (
          <p className="text-[13px] text-text-3">
            Already logged in this session — it can&apos;t be exchanged. Nothing done so far is affected.
          </p>
        ) : candidates.length === 0 ? (
          <EmptyState
            title="No fair swap"
            message="Nothing else in the catalogue matches this exercise's muscle group and your equipment."
          />
        ) : (
          <div className="flex flex-col gap-1.5">
            {candidates.map((c) => (
              <button
                key={c.slug}
                type="button"
                onClick={() => {
                  haptic("light");
                  onExchange(c.slug);
                }}
                style={{ touchAction: "manipulation" }}
                className="press flex items-center gap-3 rounded-[var(--radius-input)] bg-elevated px-3.5 py-2.5 text-left"
              >
                <Repeat className="h-4 w-4 shrink-0 text-accent-fg" strokeWidth={2} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-text-1">{c.name}</span>
                  <span className="block text-[12px] text-text-3">{c.reason}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

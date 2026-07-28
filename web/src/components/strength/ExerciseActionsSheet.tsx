"use client";

import { useState } from "react";
import { Repeat, Video } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { EmptyState } from "@/components/ui/feedback";
import { haptic } from "@/lib/haptics";
import { findExchangeCandidates } from "@/lib/strength/exchange";
import { getVideoId } from "@/lib/strength/videos";
import { VideoSheet } from "@/components/strength/VideoSheet";
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
  // Preview what you're swapping TO, not just its name — same VideoSheet
  // pattern the guided session and the reorder screen already use.
  const [videoSlug, setVideoSlug] = useState<string | null>(null);
  const videoCandidate = candidates.find((c) => c.slug === videoSlug);

  return (
    <Sheet open={open} onClose={onClose} title={exercise ? `Exchange ${exercise.name}` : "Exchange"}>
      <div className="flex flex-col gap-3 px-4 pb-6">
        {hasLoggedSets ? (
          <p className="text-[13px] text-text-3">
            Already logged in this session, it can&apos;t be exchanged. Nothing done so far is affected.
          </p>
        ) : candidates.length === 0 ? (
          <EmptyState
            title="No fair swap"
            message="Nothing else in the catalogue matches this exercise's muscle group and your equipment."
          />
        ) : (
          <div className="flex flex-col gap-1.5">
            {candidates.map((c) => (
              <div
                key={c.slug}
                className="flex items-center gap-1.5 rounded-[var(--radius-input)] bg-elevated pr-1.5"
              >
                <button
                  type="button"
                  onClick={() => {
                    haptic("light");
                    onExchange(c.slug);
                  }}
                  style={{ touchAction: "manipulation" }}
                  className="press flex min-w-0 flex-1 items-center gap-3 rounded-[var(--radius-input)] px-3.5 py-2.5 text-left"
                >
                  <Repeat className="h-4 w-4 shrink-0 text-accent-fg" strokeWidth={2} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold text-text-1">{c.name}</span>
                    <span className="block text-[12px] text-text-3">{c.reason}</span>
                  </span>
                </button>
                {getVideoId(c.slug) && (
                  <button
                    type="button"
                    onClick={() => { haptic("light"); setVideoSlug(c.slug); }}
                    aria-label={`Watch ${c.name} form demo`}
                    style={{ touchAction: "manipulation" }}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface text-text-2"
                  >
                    <Video className="h-4 w-4" strokeWidth={2.2} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <VideoSheet slug={videoSlug} title={videoCandidate?.name} onClose={() => setVideoSlug(null)} />
    </Sheet>
  );
}

"use client";

import type { ReactNode } from "react";
import { ChevronLeft, Circle } from "lucide-react";
import { NavBar } from "@/components/ui/NavBar";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { haptic } from "@/lib/haptics";
import { useSwipeBack } from "@/lib/useSwipeBack";

/** Shared shell for the /settings/* subpages: back nav + grouped-card canvas. */
export function SettingsSubpage({
  title,
  right,
  children,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  useSwipeBack();
  return (
    <main className="min-h-dvh bg-bg">
      <NavBar
        title={title}
        large={false}
        centerAlways
        right={right}
        left={
          <TransitionLink
            href="/settings"
            aria-label="Back to settings"
            className="press flex h-11 w-11 items-center justify-center rounded-lg active:bg-elevated"
          >
            <ChevronLeft className="h-6 w-6 text-text-1" strokeWidth={2.2} />
          </TransitionLink>
        }
      />
      <div className="px-4 pb-12 pt-3">{children}</div>
    </main>
  );
}

/** Benchmark-style single-select row: label left, filled radio dot on the right. */
export function RadioRow({
  title,
  subtitle,
  selected,
  onSelect,
}: {
  title: string;
  subtitle?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => {
        if (!selected) {
          haptic("light");
          onSelect();
        }
      }}
      style={{ touchAction: "manipulation" }}
      className="flex w-full items-center gap-3 border-t border-hairline/60 px-4 py-3.5 text-left first:border-t-0 active:bg-elevated"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium text-text-1">{title}</span>
        {subtitle && (
          <span className="block truncate text-[13px] text-text-3">{subtitle}</span>
        )}
      </span>
      {selected ? (
        <span
          aria-hidden
          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 border-text-1"
        >
          <span className="h-3 w-3 rounded-full bg-text-1" />
        </span>
      ) : (
        <Circle className="h-[22px] w-[22px] shrink-0 text-text-3/50" strokeWidth={1.6} />
      )}
    </button>
  );
}

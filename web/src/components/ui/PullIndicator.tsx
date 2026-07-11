"use client";

import { RefreshCw } from "lucide-react";

/** Spinner row rendered above the content while pulling / refreshing. */
export function PullIndicator({ pull, refreshing }: { pull: number; refreshing: boolean }) {
  if (pull <= 0 && !refreshing) return null;
  return (
    <div
      className="flex items-end justify-center overflow-hidden transition-[height] duration-100"
      style={{ height: pull }}
    >
      <RefreshCw
        className={`mb-3 h-5 w-5 text-text-3 ${refreshing ? "animate-spin" : ""}`}
        strokeWidth={2}
        style={refreshing ? undefined : { transform: `rotate(${pull * 2.4}deg)`, opacity: Math.min(1, pull / 48) }}
      />
    </div>
  );
}

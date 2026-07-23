"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { haptic } from "@/lib/haptics";

// A small tap-to-reveal help bubble next to a label. Mobile-friendly (tap, not
// hover); tap again or tap away closes it.
export function InfoTooltip({ text, label }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          haptic("light");
          setOpen((o) => !o);
        }}
        aria-label={label ? `About ${label}` : "More info"}
        aria-expanded={open}
        className="press flex h-5 w-5 items-center justify-center rounded-full text-text-3"
      >
        <Info className="h-4 w-4" strokeWidth={2} />
      </button>
      {open && (
        <>
          {/* tap-away catcher */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <span
            role="tooltip"
            className="absolute left-1/2 top-7 z-50 w-60 -translate-x-1/2 rounded-xl bg-elevated px-3.5 py-2.5 text-[12.5px] leading-snug text-text-1 shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
          >
            {text}
          </span>
        </>
      )}
    </span>
  );
}

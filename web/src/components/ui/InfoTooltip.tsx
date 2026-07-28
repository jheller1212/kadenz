"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { haptic } from "@/lib/haptics";

// A small tap-to-reveal help bubble next to a label. Mobile-friendly (tap, not
// hover); tap again or tap away closes it.
//
// `items` renders option-by-option guidance as its own lines instead of cramming
// "Low: … Normal: … High: …" into one paragraph, which was unreadable at this
// width.
export function InfoTooltip({
  text,
  label,
  items,
}: {
  text: string;
  label?: string;
  items?: { term: string; def: string }[];
}) {
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
            className="absolute left-1/2 top-7 z-50 w-[min(17rem,calc(100vw-3rem))] -translate-x-1/2 rounded-xl bg-elevated px-3.5 py-3 text-[12.5px] leading-relaxed text-text-1 shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
          >
            {text}
            {items && items.length > 0 && (
              <span className="mt-2 flex flex-col gap-1">
                {items.map((it) => (
                  <span key={it.term}>
                    <b className="font-bold text-text-1">{it.term}</b>
                    <span className="text-text-2">: {it.def}</span>
                  </span>
                ))}
              </span>
            )}
          </span>
        </>
      )}
    </span>
  );
}

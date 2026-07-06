"use client";

import { useEffect, useState, type ReactNode } from "react";

interface Props {
  title: string;
  /** Render the large inline title below the bar (iOS large-title style). */
  large?: boolean;
  left?: ReactNode;
  right?: ReactNode;
}

// Fixed, blurred top navigation bar. The compact centered title crossfades in
// as the page scrolls past the large inline title — the iOS large-title pattern.
export function NavBar({ title, large = true, left, right }: Props) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > (large ? 44 : 4));
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [large]);

  return (
    <>
      {/* Fixed bar: the blurred glass sits on this element; keep it always
          mounted (no opacity-toggle) per the iOS 26 toolbar-tint caveat. */}
      <header className="fixed inset-x-0 top-0 z-40 mx-auto max-w-[430px]">
        <div
          className={`material transition-opacity duration-300 ${
            scrolled ? "opacity-100 hairline-b" : "opacity-0"
          }`}
          style={{ position: "absolute", inset: 0 }}
        />
        <div
          className="relative flex items-center justify-between px-2"
          style={{
            paddingTop: "max(env(safe-area-inset-top), 8px)",
            height: "calc(max(env(safe-area-inset-top), 8px) + 44px)",
          }}
        >
          <div className="flex h-11 min-w-[64px] items-center">{left}</div>
          <h1
            className={`pointer-events-none absolute left-1/2 -translate-x-1/2 text-[17px] font-bold text-text-1 transition-opacity duration-200 ${
              scrolled ? "opacity-100" : "opacity-0"
            }`}
            style={{ top: "calc(max(env(safe-area-inset-top), 8px) + 11px)" }}
          >
            {title}
          </h1>
          <div className="flex h-11 min-w-[64px] items-center justify-end">{right}</div>
        </div>
      </header>

      {/* Spacer for the fixed bar */}
      <div style={{ height: "calc(max(env(safe-area-inset-top), 8px) + 44px)" }} />

      {large && (
        <h1 className="px-5 pb-1 pt-1 text-[34px] font-extrabold leading-tight tracking-tight text-text-1">
          {title}
        </h1>
      )}
    </>
  );
}

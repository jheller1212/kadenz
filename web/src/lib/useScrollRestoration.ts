"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Restores the window scroll position when returning to a list screen.
 * Saves continuously (throttled by rAF) into sessionStorage keyed by path.
 */
export function useScrollRestoration(ready: boolean = true) {
  const pathname = usePathname();

  // Restore once data is ready (content must exist for the offset to apply)
  useEffect(() => {
    if (!ready) return;
    const saved = sessionStorage.getItem(`kadenz_scroll:${pathname}`);
    if (saved) {
      const y = parseInt(saved, 10);
      if (Number.isFinite(y) && y > 0) {
        requestAnimationFrame(() => window.scrollTo(0, y));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pathname]);

  // Save on scroll
  useEffect(() => {
    let raf = 0;
    function onScroll() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        sessionStorage.setItem(`kadenz_scroll:${pathname}`, String(window.scrollY));
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, [pathname]);
}

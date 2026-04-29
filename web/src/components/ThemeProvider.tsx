"use client";

import { useEffect } from "react";
import { loadSettings } from "@/lib/settings";

export function ThemeProvider() {
  useEffect(() => {
    function applyTheme() {
      const settings = loadSettings();
      const html = document.documentElement;
      if (settings.theme === "light") {
        html.classList.add("light");
      } else {
        html.classList.remove("light");
      }
    }

    applyTheme();

    // Re-apply when localStorage changes (e.g. settings page updates)
    window.addEventListener("storage", applyTheme);
    // Also poll for same-tab changes
    const interval = setInterval(applyTheme, 500);

    return () => {
      window.removeEventListener("storage", applyTheme);
      clearInterval(interval);
    };
  }, []);

  return null;
}

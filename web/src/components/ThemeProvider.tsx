"use client";

import { useEffect } from "react";

export function ThemeProvider() {
  useEffect(() => {
    function applyTheme() {
      try {
        const raw = localStorage.getItem("kadenz_settings");
        const settings = raw ? JSON.parse(raw) : {};
        // Default to light if no theme set
        const theme = settings.theme ?? "light";
        if (theme === "light") {
          document.documentElement.classList.add("light");
        } else {
          document.documentElement.classList.remove("light");
        }
      } catch {
        // Default to light
        document.documentElement.classList.add("light");
      }
    }

    // Apply immediately
    applyTheme();

    // Listen for storage changes (cross-tab)
    window.addEventListener("storage", applyTheme);

    // MutationObserver on localStorage for same-tab changes
    // (storage event doesn't fire for same-tab)
    const interval = setInterval(applyTheme, 300);

    return () => {
      window.removeEventListener("storage", applyTheme);
      clearInterval(interval);
    };
  }, []);

  return null;
}

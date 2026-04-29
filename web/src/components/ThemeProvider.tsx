"use client";

import { useEffect } from "react";

const LIGHT_VARS: Record<string, string> = {
  "--color-bg": "#F5F5F7",
  "--color-surface": "#FFFFFF",
  "--color-elevated": "#EEEEF0",
  "--color-hairline": "#D8D8DC",
  "--color-text-1": "#1A1A1A",
  "--color-text-2": "#6B6B70",
  "--color-text-3": "#9A9AA0",
  "--color-accent": "#6C3AE0",
  "--color-on-accent": "#FFFFFF",
  "--color-warn": "#E8850A",
  "--color-danger": "#E03A3A",
};

export function ThemeProvider() {
  useEffect(() => {
    function applyTheme() {
      try {
        const raw = localStorage.getItem("kadenz_settings");
        const settings = raw ? JSON.parse(raw) : {};
        const theme = settings.theme ?? "light";
        const html = document.documentElement;

        if (theme === "light") {
          html.classList.add("light");
          for (const [key, value] of Object.entries(LIGHT_VARS)) {
            html.style.setProperty(key, value);
          }
        } else {
          html.classList.remove("light");
          for (const key of Object.keys(LIGHT_VARS)) {
            html.style.removeProperty(key);
          }
        }
      } catch {
        // silent
      }
    }

    applyTheme();
    window.addEventListener("storage", applyTheme);
    const interval = setInterval(applyTheme, 300);

    return () => {
      window.removeEventListener("storage", applyTheme);
      clearInterval(interval);
    };
  }, []);

  return null;
}

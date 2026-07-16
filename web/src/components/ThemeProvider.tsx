"use client";

import { useEffect } from "react";
import { SETTINGS_CHANGED_EVENT } from "@/lib/settings";

export function ThemeProvider() {
  useEffect(() => {
    function setThemeColor(color: string) {
      let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      if (!meta) {
        meta = document.createElement("meta");
        meta.name = "theme-color";
        document.head.appendChild(meta);
      }
      meta.content = color;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");

    function applyTheme() {
      try {
        const raw = localStorage.getItem("kadenz_settings");
        const settings = raw ? JSON.parse(raw) : {};
        const theme = settings.theme ?? "light";
        const dark = theme === "dark" || (theme === "system" && media.matches);
        if (dark) {
          document.documentElement.classList.remove("light");
          setThemeColor("#0A0A0B");
        } else {
          document.documentElement.classList.add("light");
          setThemeColor("#EEF0F4");
        }
      } catch {
        document.documentElement.classList.add("light");
        setThemeColor("#EEF0F4");
      }
    }

    applyTheme();
    // Same-tab saves dispatch SETTINGS_CHANGED_EVENT; "storage" covers other
    // tabs; the media listener keeps "system" in sync with live OS changes.
    window.addEventListener(SETTINGS_CHANGED_EVENT, applyTheme);
    window.addEventListener("storage", applyTheme);
    media.addEventListener("change", applyTheme);
    return () => {
      window.removeEventListener(SETTINGS_CHANGED_EVENT, applyTheme);
      window.removeEventListener("storage", applyTheme);
      media.removeEventListener("change", applyTheme);
    };
  }, []);

  return null;
}

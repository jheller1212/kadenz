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

    function applyTheme() {
      try {
        const raw = localStorage.getItem("kadenz_settings");
        const settings = raw ? JSON.parse(raw) : {};
        const theme = settings.theme ?? "light";
        if (theme === "light") {
          document.documentElement.classList.add("light");
          setThemeColor("#F5F5F7");
        } else {
          document.documentElement.classList.remove("light");
          setThemeColor("#0A0A0B");
        }
      } catch {
        document.documentElement.classList.add("light");
        setThemeColor("#F5F5F7");
      }
    }

    applyTheme();
    // Same-tab saves dispatch SETTINGS_CHANGED_EVENT; "storage" covers other tabs
    window.addEventListener(SETTINGS_CHANGED_EVENT, applyTheme);
    window.addEventListener("storage", applyTheme);
    return () => {
      window.removeEventListener(SETTINGS_CHANGED_EVENT, applyTheme);
      window.removeEventListener("storage", applyTheme);
    };
  }, []);

  return null;
}

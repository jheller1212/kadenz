"use client";

import { useEffect } from "react";

export function ThemeProvider() {
  useEffect(() => {
    function applyTheme() {
      try {
        const raw = localStorage.getItem("kadenz_settings");
        const settings = raw ? JSON.parse(raw) : {};
        const theme = settings.theme ?? "light";
        if (theme === "light") {
          document.documentElement.classList.add("light");
        } else {
          document.documentElement.classList.remove("light");
        }
      } catch {
        document.documentElement.classList.add("light");
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

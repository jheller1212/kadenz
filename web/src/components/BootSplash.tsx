"use client";

import { motion } from "motion/react";

// The canvas is #0A0A0B rather than the theme's --k-bg (#0B0B0F) on purpose:
// it has to match the ink squircle inside icon.svg exactly, otherwise the
// 150px mark reads as a faintly visible square on the flat field. The same
// value backs the native launch screens (manifest background_color and the
// apple-touch-startup-image PNGs), so OS splash → app splash is seamless.
export const SPLASH_BG = "#0A0A0B";

/**
 * Static launch screen shown while the session is probed, matching the native
 * launch image so the handoff from the OS splash is invisible. Always dark,
 * regardless of the user's theme — it's a brand moment, not a themed surface.
 */
export function BootSplash() {
  return (
    <motion.div
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
      className="k-dark-surface fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: SPLASH_BG }}
      aria-hidden
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/icon.svg"
        alt=""
        width={150}
        height={150}
        className="block h-[150px] w-[150px]"
      />
      <div className="absolute inset-x-0 bottom-[58px] text-center text-[13px] font-semibold tracking-[0.2px] text-text-3">
        Running, structured.
      </div>
    </motion.div>
  );
}

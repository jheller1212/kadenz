"use client";

import { AnimatePresence, motion, type PanInfo } from "motion/react";
import { useEffect, type ReactNode } from "react";
import { haptic } from "@/lib/haptics";

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Optional title rendered in the sheet header. */
  title?: string;
  /** Hide the grabber handle. */
  noHandle?: boolean;
}

// A native-feeling iOS bottom sheet: dimmed backdrop, rounded top, drag handle,
// and drag-to-dismiss with velocity. Built on motion so drag + spring compose.
export function Sheet({ open, onClose, children, title, noHandle }: Props) {
  // Lock body scroll while the sheet is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  function onDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.y > 120 || info.velocity.y > 500) {
      haptic("light");
      onClose();
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true">
          <motion.div
            className="absolute inset-0 [background:var(--k-scrim)]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="absolute inset-x-0 bottom-0 mx-auto max-w-[430px] rounded-t-[var(--radius-sheet)]
              [background:var(--k-float-grad)] [background-color:var(--k-float)] [box-shadow:var(--k-shadow-float)]
              pb-[max(env(safe-area-inset-bottom),16px)]"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 40 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={onDragEnd}
          >
            {!noHandle && (
              <div className="flex justify-center pt-2.5 pb-1">
                <div className="h-1.5 w-9 rounded-full bg-text-3/40" />
              </div>
            )}
            {title && (
              <h2 className="px-5 pt-1 pb-3 text-center text-[17px] font-bold text-text-1">
                {title}
              </h2>
            )}
            <div className="max-h-[80dvh] overflow-y-auto px-5 pt-1 scroll-native">
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

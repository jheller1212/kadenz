"use client";

import { ResumeWorkoutPill } from "@/components/ResumeWorkoutPill";

import { motion } from "motion/react";
import { Home, CalendarDays, Dumbbell, Activity, BarChart3 } from "lucide-react";
import { TransitionLink } from "@/components/ui/TransitionLink";

type Tab = "today" | "plan" | "strength" | "activities" | "stats";

interface Props {
  active?: Tab;
}

const tabs: { id: Tab; label: string; href: string; Icon: typeof Home }[] = [
  { id: "today", label: "Today", href: "/", Icon: Home },
  { id: "plan", label: "Plan", href: "/plan", Icon: CalendarDays },
  { id: "strength", label: "Kraft", href: "/strength", Icon: Dumbbell },
  { id: "activities", label: "Activities", href: "/activities", Icon: Activity },
  { id: "stats", label: "Stats", href: "/stats", Icon: BarChart3 },
];

export function BottomNav({ active }: Props) {
  return (
    <>
    <ResumeWorkoutPill />
    <nav
      className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-[430px]"
      aria-label="Main navigation"
    >
      {/* Blurred glass on an absolute child, not the fixed element itself. */}
      <div className="absolute inset-0 material hairline-t" />
      <div
        className="relative flex"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {tabs.map(({ id, label, href, Icon }) => {
          const isActive = id === active;
          return (
            <TransitionLink
              key={id}
              href={href}
              buzz
              aria-label={label}
              aria-current={isActive ? "page" : undefined}
              className="relative flex flex-1 flex-col items-center gap-0.5 pt-2 pb-1.5"
            >
              <motion.span
                animate={{ scale: isActive ? 1 : 0.92, y: isActive ? -1 : 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 28 }}
                className={isActive ? "text-accent-fg" : "text-text-3"}
              >
                <Icon className="h-6 w-6" strokeWidth={isActive ? 2.4 : 1.9} />
              </motion.span>
              <span
                className={`text-[10px] font-semibold tracking-tight ${
                  isActive ? "text-accent-fg" : "text-text-3"
                }`}
              >
                {label}
              </span>
            </TransitionLink>
          );
        })}
      </div>
    </nav>
    </>
  );
}

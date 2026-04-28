"use client";

import Link from "next/link";

type Tab = "today" | "plan" | "stats";

interface Props {
  active: Tab;
}

const tabs: { id: Tab; label: string; href: string; icon: React.ReactNode }[] = [
  {
    id: "today",
    label: "Today",
    href: "/",
    icon: (
      <svg
        className="w-5 h-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.75}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 3v1m0 16v1M4.22 4.22l.707.707M18.364 18.364l.707.707M3 12H2m20 0h-1M4.927 19.073l.707-.707M18.364 5.636l.707-.707M12 7a5 5 0 1 0 0 10A5 5 0 0 0 12 7z"
        />
      </svg>
    ),
  },
  {
    id: "plan",
    label: "Plan",
    href: "/plan",
    icon: (
      <svg
        className="w-5 h-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.75}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"
        />
      </svg>
    ),
  },
  {
    id: "stats",
    label: "Stats",
    href: "/stats",
    icon: (
      <svg
        className="w-5 h-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.75}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
        />
      </svg>
    ),
  },
];

export function BottomNav({ active }: Props) {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-hairline bg-surface/90 backdrop-blur-md"
      aria-label="Main navigation"
    >
      <div className="flex max-w-[430px] mx-auto">
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              className={`flex flex-1 flex-col items-center gap-1 py-3 text-[11px] font-medium transition-colors ${
                isActive ? "text-accent" : "text-text-3"
              }`}
              aria-current={isActive ? "page" : undefined}
              aria-label={tab.label}
            >
              {tab.icon}
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

"use client";

import { User } from "lucide-react";
import { TransitionLink } from "@/components/ui/TransitionLink";

/**
 * Profile avatar shown top-left in the nav on top-level screens.
 * Opens Settings ("Me") — the destination the old bottom "Me" tab pointed to.
 */
export function ProfileAvatar() {
  return (
    <TransitionLink
      href="/settings"
      buzz
      aria-label="Profile and settings"
      className="press flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 ring-1 ring-inset ring-accent/30"
    >
      <User className="h-[18px] w-[18px] text-accent" strokeWidth={2} />
    </TransitionLink>
  );
}

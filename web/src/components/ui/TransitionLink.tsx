"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { forwardRef, type ComponentProps, type MouseEvent } from "react";
import { haptic } from "@/lib/haptics";

type Props = ComponentProps<typeof Link> & {
  /** Fire a light haptic on tap (default true). */
  buzz?: boolean;
};

// A drop-in <Link> that wraps navigation in document.startViewTransition when
// the browser supports it (Safari 18+, Chrome 111+), giving a native-feeling
// crossfade between routes. Everywhere else it's an ordinary Link.
export const TransitionLink = forwardRef<HTMLAnchorElement, Props>(
  function TransitionLink({ href, buzz = true, onClick, ...rest }, ref) {
    const router = useRouter();

    function handleClick(e: MouseEvent<HTMLAnchorElement>) {
      onClick?.(e);
      if (buzz) haptic("light");

      const doc = document as Document & {
        startViewTransition?: (cb: () => void) => void;
      };
      // Only enhance plain left-clicks to internal string hrefs.
      const isPlain =
        !e.defaultPrevented &&
        e.button === 0 &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        !e.altKey &&
        typeof href === "string";

      if (isPlain && typeof doc.startViewTransition === "function") {
        e.preventDefault();
        doc.startViewTransition(() => router.push(href as string));
      }
    }

    return <Link ref={ref} href={href} onClick={handleClick} {...rest} />;
  }
);

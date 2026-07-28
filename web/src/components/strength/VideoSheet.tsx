"use client";

import { Sheet } from "@/components/ui/Sheet";
import { getVideoId } from "@/lib/strength/videos";

interface Props {
  /** Exercise slug to show a demo for; null = closed. */
  slug: string | null;
  title?: string;
  onClose: () => void;
}

// Short form-demo video in a bottom sheet. Deliberately non-blocking: the
// guided session's timers are wall-clock anchored, so they keep running
// while the sheet is open.
export function VideoSheet({ slug, title, onClose }: Props) {
  const id = slug ? getVideoId(slug) : null;
  return (
    <Sheet open={!!id} onClose={onClose} title={title ?? "Form demo"}>
      <div className="px-4 pb-6">
        {id && (
          <div className="overflow-hidden rounded-[var(--radius-input)] bg-black" style={{ aspectRatio: "16 / 9" }}>
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${id}?playsinline=1&autoplay=1&rel=0`}
              title={title ?? "Exercise demo"}
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              className="h-full w-full border-0"
            />
          </div>
        )}
        <p className="mt-2 text-center text-[12px] text-text-3">
          Timers keep running, close when you&apos;re ready.
        </p>
      </div>
    </Sheet>
  );
}

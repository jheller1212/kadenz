"use client";

import type { ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// Long-press-draggable list item (sensors live in the parent DndContext —
// MouseSensor + TouchSensor with a 250ms delay, NOT PointerSensor, which
// can't cancel iOS scroll panning). The whole card is the drag surface;
// taps still reach inner buttons because activation needs the hold.
export function SortableItem({
  id,
  className,
  children,
  "data-testid": testId,
}: {
  id: string;
  className?: string;
  children: ReactNode;
  "data-testid"?: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      data-testid={testId}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        touchAction: "manipulation",
      }}
      className={`${className ?? ""}${isDragging ? " relative z-10 opacity-80" : ""}`}
    >
      {children}
    </div>
  );
}

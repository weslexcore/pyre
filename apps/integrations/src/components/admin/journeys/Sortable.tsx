// Drag-to-reorder for the journey editor's lists (the steps timeline, an
// email's blocks). Built on @dnd-kit's sortable preset like the boards, for
// the same reason: touch. A mouse drag starts after a few pixels; a finger
// has to press and hold so a swipe still scrolls the page. The handle is
// also a keyboard control: focus it and use the up and down arrows.

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { type ReactNode, useState } from 'react';

export interface HandleProps {
  /** Spread on the drag handle button. */
  handle: {
    ref: (el: HTMLElement | null) => void;
    [key: string]: unknown;
  };
  isDragging: boolean;
}

export function SortableList<T>({
  items,
  getId,
  getLabel,
  onReorder,
  children,
  className = 'flex flex-col gap-1.5',
}: {
  items: T[];
  getId: (item: T) => string;
  /** For the screen-reader announcement after a move. */
  getLabel: (item: T) => string;
  onReorder: (next: T[]) => void;
  children: (item: T, index: number, drag: HandleProps) => ReactNode;
  className?: string;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const [announcement, setAnnouncement] = useState('');
  const ids = items.map(getId);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(items, from, to);
    onReorder(next);
    setAnnouncement(`${getLabel(items[from])} moved to position ${to + 1} of ${items.length}.`);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ol className={className}>
          {items.map((item, index) => (
            <SortableRow key={getId(item)} id={getId(item)}>
              {(drag) => children(item, index, drag)}
            </SortableRow>
          ))}
        </ol>
      </SortableContext>
      <span className="sr-only" role="status">
        {announcement}
      </span>
    </DndContext>
  );
}

function SortableRow({ id, children }: { id: string; children: (drag: HandleProps) => ReactNode }) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    listeners,
    attributes,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
      }}
      className={`relative ${isDragging ? 'z-10 opacity-80 shadow-xl' : ''}`}
    >
      {children({ handle: { ref: setActivatorNodeRef, ...attributes, ...listeners }, isDragging })}
    </li>
  );
}

/** The grip a row is dragged by. */
export function DragHandle({ drag, label }: { drag: HandleProps; label: string }) {
  const { ref, ...rest } = drag.handle;
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      aria-label={`Drag to reorder ${label} (or focus and use the arrow keys)`}
      title="Drag to reorder"
      className="flex h-8 w-6 shrink-0 touch-none cursor-grab items-center justify-center rounded text-white/35 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-[var(--pyre-gold)] active:cursor-grabbing"
    >
      <svg width="12" height="18" viewBox="0 0 16 20" fill="currentColor" aria-hidden="true">
        <circle cx="5" cy="5" r="1.5" />
        <circle cx="11" cy="5" r="1.5" />
        <circle cx="5" cy="10" r="1.5" />
        <circle cx="11" cy="10" r="1.5" />
        <circle cx="5" cy="15" r="1.5" />
        <circle cx="11" cy="15" r="1.5" />
      </svg>
    </button>
  );
}

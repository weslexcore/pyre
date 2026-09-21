// Drag-and-drop for a board: pick a card up, drop it on a column. Built on
// @dnd-kit/core, which is here for one reason — touch. A mouse drag is a
// mousedown and a few pixels of movement; a finger on a phone is also how
// you scroll the page, so a touch drag has to wait for a press-and-hold
// before it claims the gesture, and the page has to keep scrolling when the
// card is carried past the edge of the screen. Both are dnd-kit's job.
//
// The column select on every row stays. It is the keyboard and screen-reader
// path, and on a phone it is still the surest way to move one card three
// columns down without a long drag.

import {
  type DragEndEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { ReactNode } from 'react';
import type { BoardCardRow, BoardColumnRow } from '@/lib/db';

export type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
export { DndContext, DragOverlay } from '@dnd-kit/core';

/**
 * A mouse needs a few pixels of movement, so a click still opens the card. A
 * finger needs to hold for a moment, so a swipe still scrolls the page and a
 * tap still opens the card; a little wobble during the hold is tolerated.
 */
export function useBoardSensors() {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } })
  );
}

/** The column a drop landed in, or null when it went nowhere new. */
export function droppedColumn(
  event: DragEndEvent,
  cards: Pick<BoardCardRow, 'id' | 'column_id'>[],
  columns: Pick<BoardColumnRow, 'id' | 'archived'>[]
): { card: Pick<BoardCardRow, 'id' | 'column_id'>; columnId: string } | null {
  const card = cards.find((row) => row.id === String(event.active.id));
  const column = event.over ? columns.find((row) => row.id === String(event.over?.id)) : null;
  if (!card || !column) return null;
  // A retired column keeps showing while it holds cards, but takes no new ones.
  if (column.archived || column.id === card.column_id) return null;
  return { card, columnId: column.id };
}

/** A column as a drop target: lights up while a card is held over it. */
export function DroppableColumn({
  column,
  disabled = false,
  className,
  children,
}: {
  column: Pick<BoardColumnRow, 'id' | 'archived'>;
  disabled?: boolean;
  className: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver, active } = useDroppable({
    id: column.id,
    disabled: disabled || column.archived,
  });
  const receiving = isOver && !column.archived;
  return (
    <section
      ref={setNodeRef}
      className={`${className} transition-colors ${
        receiving
          ? 'border-[var(--pyre-gold)]/60 bg-[var(--pyre-gold)]/5'
          : active && !column.archived
            ? 'border-white/20'
            : ''
      }`}
    >
      {children}
    </section>
  );
}

/**
 * A card as something to pick up. Renders its child with the drag listeners
 * to spread onto the row, and fades the original while its ghost is being
 * carried in the DragOverlay.
 */
export function DraggableCard({
  card,
  disabled = false,
  children,
}: {
  card: Pick<BoardCardRow, 'id'>;
  disabled?: boolean;
  children: (drag: {
    listeners: DraggableSyntheticListeners;
    attributes: DraggableAttributes;
    dragging: boolean;
  }) => ReactNode;
}) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: card.id,
    disabled,
  });
  return (
    <div ref={setNodeRef} className={isDragging ? 'opacity-30' : undefined}>
      {children({ listeners, attributes, dragging: isDragging })}
    </div>
  );
}

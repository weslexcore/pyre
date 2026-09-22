// Drag-and-drop for a board: pick a card up, drop it on a column or between
// two cards. Built on @dnd-kit/core and its sortable preset, which are here
// for one reason — touch. A mouse drag is a
// mousedown and a few pixels of movement; a finger on a phone is also how
// you scroll the page, so a touch drag has to wait for a press-and-hold
// before it claims the gesture, and the page has to keep scrolling when the
// card is carried past the edge of the screen. Both are dnd-kit's job.
//
// Each column is a sortable list of its cards, so dragging within a column
// shows the neighbours making room; dropping on another column's card takes
// that card's place, dropping on the column itself goes last (lib/boards/
// reorder.ts decides). The drawer's Column field stays as the keyboard path.

import {
  closestCenter,
  closestCorners,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { ReactNode } from 'react';
import type { BoardCardRow, BoardColumnRow } from '@/lib/db';

export type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
export { DndContext, DragOverlay } from '@dnd-kit/core';

/** Cards sit inside their column's box, so the nearest corners pick the card
 * under the pointer and fall back to the column when there is none. */
export const boardCollisions = closestCorners;

/**
 * Day cells tile the grid with no gaps, so the cell whose centre is nearest
 * the pointer is the one being aimed at — closestCorners would let a tall
 * cell's corner win over the cell the cursor is actually inside.
 */
export const dayCollisions = closestCenter;

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
  // Held over the column or over any card in it.
  const overCard = active && (active.data.current as { columnId?: string } | undefined)?.columnId;
  const receiving = !column.archived && (isOver || overCard === column.id);
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
 * A day cell on the calendar as a drop target. Unlike a column, a day is
 * always a legal destination — every date exists — so it only has to say so
 * while something is held over it.
 */
export function DroppableDay({
  date,
  disabled = false,
  className,
  children,
}: {
  date: string;
  disabled?: boolean;
  className: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver, active } = useDroppable({ id: `day:${date}`, disabled });
  return (
    <div
      ref={setNodeRef}
      className={`${className} transition-colors ${
        isOver
          ? 'bg-[var(--pyre-gold)]/10 ring-1 ring-inset ring-[var(--pyre-gold)]/60'
          : active
            ? 'ring-1 ring-inset ring-white/10'
            : ''
      }`}
    >
      {children}
    </div>
  );
}

/**
 * A calendar entry as something to pick up. Not sortable — a day has no
 * order to drop into, only a date — so this is the plain draggable.
 */
export function DraggableEntry({
  id,
  disabled = false,
  children,
}: {
  id: string;
  disabled?: boolean;
  children: (drag: {
    listeners: DraggableSyntheticListeners;
    attributes: DraggableAttributes;
    dragging: boolean;
  }) => ReactNode;
}) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id, disabled });
  return (
    <div ref={setNodeRef} className={isDragging ? 'opacity-30' : undefined}>
      {children({ listeners, attributes, dragging: isDragging })}
    </div>
  );
}

/** One column's cards as a sortable list, in the order shown. */
export function SortableColumn({ cardIds, children }: { cardIds: string[]; children: ReactNode }) {
  return (
    <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
      {children}
    </SortableContext>
  );
}

/**
 * A card as something to pick up and a place another card can be dropped.
 * Renders its child with the drag listeners to spread onto the row, shifts
 * to make room while a neighbour is carried past, and fades the original
 * while its own ghost is in the DragOverlay.
 */
export function DraggableCard({
  card,
  disabled = false,
  children,
}: {
  card: Pick<BoardCardRow, 'id' | 'column_id'>;
  disabled?: boolean;
  children: (drag: {
    listeners: DraggableSyntheticListeners;
    attributes: DraggableAttributes;
    dragging: boolean;
  }) => ReactNode;
}) {
  const { setNodeRef, listeners, attributes, isDragging, transform, transition } = useSortable({
    id: card.id,
    disabled,
    data: { columnId: card.column_id },
  });
  return (
    <div
      ref={setNodeRef}
      className={isDragging ? 'opacity-30' : undefined}
      style={{
        transform: transform
          ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)`
          : undefined,
        transition,
      }}
    >
      {children({ listeners, attributes, dragging: isDragging })}
    </div>
  );
}

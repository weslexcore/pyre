// The session around a native HTML5 drag-to-reorder where the list rearranges
// live as the drag passes over items (the pinned tools grid, the SOP library).
// The caller owns the list and how an item moves; this owns what every such
// drag has to get right: starting a drag at all, not replaying a move when
// dragenter refires for a target's children, and telling a real drop (commit
// the arrangement on screen) from Escape or a release outside (restore it).

import { type DragEvent, useRef, useState } from 'react';

export interface LiveReorder<D, S> {
  /** What is being dragged, or null between drags. */
  drag: D | null;
  /**
   * Start a drag of `item`, remembering `snapshot` (the order to restore on
   * cancel). `text` is the dataTransfer payload some browsers need; with
   * `cardSelector`, the closest matching ancestor becomes the drag image
   * instead of the handle the drag started on.
   */
  begin(e: DragEvent, item: D, snapshot: S, text: string, cardSelector?: string): void;
  /** True the first time `key` is entered this drag; false on a repeat. */
  enterOnce(key: string): boolean;
  /** The order as of drag start. */
  snapshot(): S | null;
  /** For the item's onDragEnd. */
  end(): void;
  /** Spread on the container: anywhere inside it counts as a drop. */
  surface: { onDragOver(e: DragEvent): void; onDrop(e: DragEvent): void };
}

export function useLiveReorder<D, S>({
  onDrop,
  onCancel,
}: {
  onDrop: (item: D, snapshot: S | null) => void;
  onCancel: (snapshot: S) => void;
}): LiveReorder<D, S> {
  const [drag, setDrag] = useState<D | null>(null);
  const snapshotRef = useRef<S | null>(null);
  const droppedRef = useRef(false);
  const lastEnterRef = useRef<string | null>(null);

  return {
    drag,
    begin(e, item, snapshot, text, cardSelector) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', text);
      if (cardSelector) {
        const card = (e.currentTarget as HTMLElement).closest(cardSelector);
        if (card instanceof HTMLElement) e.dataTransfer.setDragImage(card, 24, 24);
      }
      snapshotRef.current = snapshot;
      droppedRef.current = false;
      lastEnterRef.current = null;
      setDrag(item);
    },
    enterOnce(key) {
      if (lastEnterRef.current === key) return false;
      lastEnterRef.current = key;
      return true;
    },
    snapshot: () => snapshotRef.current,
    end() {
      const finished = drag;
      setDrag(null);
      if (!finished) return;
      const before = snapshotRef.current;
      snapshotRef.current = null;
      if (droppedRef.current) onDrop(finished, before);
      else if (before) onCancel(before);
    },
    surface: {
      onDragOver(e) {
        if (drag) e.preventDefault();
      },
      onDrop(e) {
        if (drag) {
          e.preventDefault();
          droppedRef.current = true;
        }
      },
    },
  };
}

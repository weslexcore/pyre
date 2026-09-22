import { DndContext, DragOverlay, useDraggable, useDroppable } from '@dnd-kit/core';
import { type ReactNode, useState } from 'react';
import { useBoardSensors } from './dnd';

/** Moves whole drafts, preserving their keys and unsaved edits. */
export function reorderColumns<T extends { key: string }>(
  items: T[],
  from: string,
  to: string
): T[] {
  const source = items.findIndex((item) => item.key === from);
  const target = items.findIndex((item) => item.key === to);
  if (source < 0 || target < 0 || source === target) return items;
  const next = [...items];
  next.splice(target, 0, ...next.splice(source, 1));
  return next;
}

const COLUMN_HELP =
  'Drag the handles to reorder columns, or focus a handle and use the up and down arrow keys. Choose Save board to apply.';

export function ColumnOrder<T extends { key: string; label: string }>({
  items,
  disabled,
  onChange,
  children,
  help = COLUMN_HELP,
}: {
  items: T[];
  disabled: boolean;
  onChange: (items: T[]) => void;
  children: (item: T, index: number) => ReactNode;
  /** The line above the list; the column wording unless the list holds something else. */
  help?: string;
}) {
  const sensors = useBoardSensors();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const activeIndex = items.findIndex((item) => item.key === activeKey);
  const active = items[activeIndex];
  const move = (from: string, to: string) => {
    if (disabled) return;
    const next = reorderColumns(items, from, to);
    onChange(next);
    const index = next.findIndex((item) => item.key === from);
    if (index >= 0) {
      setAnnouncement(`${next[index].label} moved to position ${index + 1} of ${next.length}.`);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={({ active }) => setActiveKey(String(active.id))}
      onDragCancel={() => setActiveKey(null)}
      onDragEnd={({ active, over }) => {
        setActiveKey(null);
        if (over) move(String(active.id), String(over.id));
      }}
    >
      <p id="column-order-help" className="mb-3 text-xs text-white/50">
        {help}
      </p>
      <div className="space-y-2">
        {items.map((item, index) => (
          <ColumnOrderRow
            key={item.key}
            item={item}
            disabled={disabled}
            insertAfter={activeIndex < index}
            onMove={(direction) => {
              const target = items[index + direction];
              if (target) move(item.key, target.key);
            }}
          >
            {children(item, index)}
          </ColumnOrderRow>
        ))}
      </div>
      <span className="sr-only" role="status">
        {announcement}
      </span>
      <DragOverlay dropAnimation={null}>
        {active ? (
          <div className="rounded border border-[var(--pyre-gold)] bg-neutral-900 px-4 py-3 text-sm text-white shadow-xl">
            {active.label}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function ColumnOrderRow({
  item,
  disabled,
  insertAfter,
  onMove,
  children,
}: {
  item: { key: string; label: string };
  disabled: boolean;
  insertAfter: boolean;
  onMove: (direction: number) => void;
  children: ReactNode;
}) {
  const { setNodeRef, setActivatorNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: item.key,
    disabled,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: item.key, disabled });
  return (
    <div ref={setDropRef} className="relative">
      {isOver && !isDragging && (
        <div
          className={`pointer-events-none absolute inset-x-0 h-0.5 bg-[var(--pyre-gold)] ${insertAfter ? '-bottom-1' : '-top-1'}`}
        />
      )}
      <div ref={setNodeRef} className={`flex items-start gap-2 ${isDragging ? 'opacity-30' : ''}`}>
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          disabled={disabled}
          aria-label={`Reorder ${item.label}`}
          aria-describedby="column-order-help"
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault();
              onMove(event.key === 'ArrowUp' ? -1 : 1);
            }
          }}
          className="flex h-10 w-8 shrink-0 touch-none items-center justify-center rounded text-white/40 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-[var(--pyre-gold)] enabled:cursor-grab enabled:active:cursor-grabbing disabled:opacity-40"
        >
          <svg width="16" height="20" viewBox="0 0 16 20" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="5" r="1.5" />
            <circle cx="11" cy="5" r="1.5" />
            <circle cx="5" cy="10" r="1.5" />
            <circle cx="11" cy="10" r="1.5" />
            <circle cx="5" cy="15" r="1.5" />
            <circle cx="11" cy="15" r="1.5" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

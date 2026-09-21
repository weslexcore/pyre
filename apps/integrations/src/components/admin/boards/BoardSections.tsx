// The boards index laid out under its sections, and — for whoever holds the
// whole tool — the controls to arrange it: drag a section handle to reorder
// the headings, drag a board's handle onto another board or another section
// to move it, rename a heading in place, delete an empty one, add a new one.
// The same shelf the SOP library has, on the drag primitives the boards
// already use (dnd.tsx), so it works with a finger as well as a mouse.
//
// Live reordering is shown while dragging and persisted on drop as the
// whole order (api/admin/board-order.ts); a refused drop reloads, which
// puts everything back.

import { DndContext, DragOverlay, useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  groupBySection,
  moveBoardToSectionEnd,
  repositionBoard,
  repositionSection,
  sectionsInOrder,
} from '@/lib/boards/sections';
import { BOARD_LIMITS } from '@/lib/boards/types';
import type { BoardRow, BoardSectionRow } from '@/lib/db';
import { ConfirmDialog } from '../ConfirmDialog';
import { buttonClass, inputBaseClass, send } from '../goalsUi';
import { boardCollisions, useBoardSensors } from './dnd';

type Kind = 'section' | 'board';
const prefix = (kind: Kind, id: string) => `${kind}:${id}`;
const parse = (raw: unknown): { kind: Kind; id: string } | null => {
  const value = String(raw);
  const at = value.indexOf(':');
  if (at < 0) return null;
  const kind = value.slice(0, at);
  if (kind !== 'section' && kind !== 'board') return null;
  return { kind, id: value.slice(at + 1) };
};
/** The unnamed group's droppable id; it has no section row. */
const LOOSE = 'section:';

const handleClass =
  'flex h-8 w-7 shrink-0 touch-none items-center justify-center rounded text-white/35 hover:bg-white/10 hover:text-white enabled:cursor-grab enabled:active:cursor-grabbing disabled:opacity-30';

function Grip() {
  return (
    <svg width="14" height="18" viewBox="0 0 16 20" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="5" r="1.5" />
      <circle cx="11" cy="5" r="1.5" />
      <circle cx="5" cy="10" r="1.5" />
      <circle cx="11" cy="10" r="1.5" />
      <circle cx="5" cy="15" r="1.5" />
      <circle cx="11" cy="15" r="1.5" />
    </svg>
  );
}

export function BoardSections({
  sections,
  boards,
  canManage,
  busy,
  renderBoard,
  onChanged,
  onError,
}: {
  sections: BoardSectionRow[];
  /** Active boards only, in display order. */
  boards: BoardRow[];
  canManage: boolean;
  busy: boolean;
  /** A board's card; `handle` is the drag grip to place inside it, or null. */
  renderBoard: (board: BoardRow, handle: ReactNode) => ReactNode;
  /** After anything was written; the caller reloads. */
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  // The live arrangement while dragging; reseeded whenever the server's
  // answer changes.
  const [liveSections, setLiveSections] = useState(() => sectionsInOrder(sections));
  const [liveBoards, setLiveBoards] = useState(boards);
  useEffect(() => setLiveSections(sectionsInOrder(sections)), [sections]);
  useEffect(() => setLiveBoards(boards), [boards]);

  const [dragging, setDragging] = useState<{ kind: Kind; id: string } | null>(null);
  const [renaming, setRenaming] = useState<BoardSectionRow | null>(null);
  const [deleting, setDeleting] = useState<BoardSectionRow | null>(null);
  const [addingSection, setAddingSection] = useState(false);
  const [sectionDraft, setSectionDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const sensors = useBoardSensors();

  const groups = useMemo(
    () => groupBySection(liveSections, liveBoards),
    [liveSections, liveBoards]
  );
  const locked = busy || saving || !canManage;

  const write = async (run: () => Promise<unknown>) => {
    setSaving(true);
    try {
      await run();
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'That did not save');
      await onChanged();
    } finally {
      setSaving(false);
    }
  };

  const onDragOver = ({
    active,
    over,
  }: {
    active: { id: unknown };
    over: { id: unknown } | null;
  }) => {
    const from = parse(active.id);
    const to = over ? parse(over.id) : null;
    if (!from || !to) return;
    if (from.kind === 'section') {
      if (to.kind === 'section' && to.id) {
        setLiveSections((current) => repositionSection(current, from.id, to.id));
      }
      return;
    }
    if (to.kind === 'board') setLiveBoards((current) => repositionBoard(current, from.id, to.id));
    else setLiveBoards((current) => moveBoardToSectionEnd(current, from.id, to.id || null));
  };

  const onDragEnd = ({ active }: { active: { id: unknown } }) => {
    const from = parse(active.id);
    setDragging(null);
    if (!from) return;
    if (from.kind === 'section') {
      void write(() =>
        send('/api/admin/board-order', 'PUT', { sectionIds: liveSections.map((s) => s.id) })
      );
      return;
    }
    const moved = liveBoards.find((board) => board.id === from.id);
    if (!moved) return;
    const sectionId = moved.section_id;
    void write(() =>
      send('/api/admin/board-order', 'PUT', {
        sectionId,
        boardIds: liveBoards.filter((board) => board.section_id === sectionId).map((b) => b.id),
      })
    );
  };

  const addSection = async (event: FormEvent) => {
    event.preventDefault();
    const name = sectionDraft.trim();
    if (!name) return;
    await write(() => send('/api/admin/board-sections', 'POST', { name }));
    setSectionDraft('');
    setAddingSection(false);
  };

  const draggingSection =
    dragging?.kind === 'section' ? liveSections.find((s) => s.id === dragging.id) : null;
  const draggingBoard =
    dragging?.kind === 'board' ? liveBoards.find((b) => b.id === dragging.id) : null;

  return (
    <div className="space-y-6">
      <DndContext
        sensors={sensors}
        collisionDetection={boardCollisions}
        onDragStart={({ active }) => setDragging(parse(active.id))}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setDragging(null);
          setLiveSections(sectionsInOrder(sections));
          setLiveBoards(boards);
        }}
      >
        <SortableContext
          items={liveSections.map((s) => prefix('section', s.id))}
          strategy={verticalListSortingStrategy}
        >
          {groups.map(({ section, boards: inSection }) => (
            <SectionBlock
              key={section?.id ?? 'loose'}
              section={section}
              boards={inSection}
              canManage={canManage}
              locked={locked}
              dragging={dragging}
              renaming={renaming?.id === section?.id ? renaming : null}
              renderBoard={renderBoard}
              onRenameStart={() => section && setRenaming(section)}
              onRenameDone={async (name) => {
                const current = renaming;
                setRenaming(null);
                if (!current || !name || name === current.name) return;
                await write(() =>
                  send('/api/admin/board-sections', 'PATCH', { id: current.id, name })
                );
              }}
              onDelete={() => section && setDeleting(section)}
            />
          ))}
        </SortableContext>

        <DragOverlay dropAnimation={null}>
          {draggingSection && (
            <div className="rounded border border-[var(--pyre-gold)] bg-[var(--pyre-black)] px-4 py-2 font-mono text-xs uppercase tracking-wide text-white shadow-xl">
              {draggingSection.name}
            </div>
          )}
          {draggingBoard && (
            <div className="rounded border border-[var(--pyre-gold)] bg-[var(--pyre-black)] px-4 py-3 text-sm text-[var(--pyre-creme)] shadow-xl">
              {draggingBoard.name}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {canManage &&
        (addingSection ? (
          <form onSubmit={addSection} className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="new-section-name">
              Section name
            </label>
            <input
              id="new-section-name"
              className={`${inputBaseClass} w-64 max-w-full`}
              type="text"
              maxLength={BOARD_LIMITS.sectionName}
              placeholder="Section name"
              value={sectionDraft}
              disabled={saving}
              onChange={(e) => setSectionDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setAddingSection(false);
              }}
            />
            <button type="submit" className={buttonClass} disabled={saving || !sectionDraft.trim()}>
              Add
            </button>
            <button type="button" className={buttonClass} onClick={() => setAddingSection(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" className={buttonClass} onClick={() => setAddingSection(true)}>
            Add section
          </button>
        ))}

      {deleting && (
        <ConfirmDialog
          title={`Delete the "${deleting.name}" section?`}
          body="It is empty, so nothing goes with it."
          confirmLabel="Delete section"
          danger
          busy={saving}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const id = deleting.id;
            setDeleting(null);
            void write(() => send(`/api/admin/board-sections?id=${id}`, 'DELETE'));
          }}
        />
      )}
    </div>
  );
}

function SectionBlock({
  section,
  boards,
  canManage,
  locked,
  dragging,
  renaming,
  renderBoard,
  onRenameStart,
  onRenameDone,
  onDelete,
}: {
  section: BoardSectionRow | null;
  boards: BoardRow[];
  canManage: boolean;
  locked: boolean;
  dragging: { kind: Kind; id: string } | null;
  renaming: BoardSectionRow | null;
  renderBoard: (board: BoardRow, handle: ReactNode) => ReactNode;
  onRenameStart: () => void;
  onRenameDone: (name: string) => Promise<void>;
  onDelete: () => void;
}) {
  const id = section ? prefix('section', section.id) : LOOSE;
  const sortable = useSortable({ id, disabled: locked || !section });
  const drop = useDroppable({ id, disabled: locked });
  const [draft, setDraft] = useState(section?.name ?? '');
  const cancelled = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) {
      setDraft(renaming.name);
      cancelled.current = false;
      input.current?.focus();
      input.current?.select();
    }
  }, [renaming]);

  const receiving = dragging?.kind === 'board' && drop.isOver;
  const beingDragged = dragging?.kind === 'section' && section?.id === dragging.id;

  return (
    <section
      ref={(node) => {
        sortable.setNodeRef(node);
        drop.setNodeRef(node);
      }}
      style={{
        transform: sortable.transform
          ? `translate3d(${Math.round(sortable.transform.x)}px, ${Math.round(sortable.transform.y)}px, 0)`
          : undefined,
        transition: sortable.transition,
      }}
      className={`rounded border p-3 transition-colors ${
        receiving ? 'border-[var(--pyre-gold)]/60 bg-[var(--pyre-gold)]/5' : 'border-transparent'
      } ${beingDragged ? 'opacity-40' : ''}`}
    >
      <div className="mb-3 flex items-center gap-2">
        {canManage && section && (
          <button
            ref={sortable.setActivatorNodeRef}
            type="button"
            className={handleClass}
            disabled={locked}
            aria-label={`Reorder ${section.name}`}
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <Grip />
          </button>
        )}
        {renaming && section ? (
          <input
            ref={input}
            className={`${inputBaseClass} w-64 max-w-full py-1`}
            type="text"
            maxLength={BOARD_LIMITS.sectionName}
            value={draft}
            aria-label={`Rename ${section.name}`}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (cancelled.current) {
                cancelled.current = false;
                void onRenameDone(section.name);
                return;
              }
              void onRenameDone(draft.trim());
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                cancelled.current = true;
                e.currentTarget.blur();
              }
            }}
          />
        ) : (
          <h2 className="font-mono text-xs uppercase tracking-wide text-white/50">
            {section ? section.name : 'Other boards'}
          </h2>
        )}
        {canManage && section && !renaming && (
          <span className="flex items-center gap-2 font-mono text-[11px] text-white/35">
            <button type="button" className="underline hover:text-white/70" onClick={onRenameStart}>
              rename
            </button>
            {boards.length === 0 && (
              <button
                type="button"
                className="underline hover:text-[var(--pyre-red)]"
                onClick={onDelete}
              >
                delete
              </button>
            )}
          </span>
        )}
      </div>

      <SortableContext items={boards.map((b) => prefix('board', b.id))}>
        <div className="grid gap-3 sm:grid-cols-2">
          {boards.map((board) => (
            <SortableBoard key={board.id} board={board} canManage={canManage} locked={locked}>
              {renderBoard}
            </SortableBoard>
          ))}
        </div>
      </SortableContext>
      {boards.length === 0 && (
        <p
          className={`rounded border border-dashed px-3 py-4 text-center font-mono text-xs ${
            dragging?.kind === 'board'
              ? 'border-white/25 text-white/50'
              : 'border-white/10 text-white/30'
          }`}
        >
          {dragging?.kind === 'board' ? 'Drop it here.' : 'No boards here yet.'}
        </p>
      )}
    </section>
  );
}

function SortableBoard({
  board,
  canManage,
  locked,
  children,
}: {
  board: BoardRow;
  canManage: boolean;
  locked: boolean;
  children: (board: BoardRow, handle: ReactNode) => ReactNode;
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: prefix('board', board.id), disabled: locked });
  const handle = canManage ? (
    <button
      ref={setActivatorNodeRef}
      type="button"
      className={handleClass}
      disabled={locked}
      aria-label={`Move ${board.name}`}
      {...attributes}
      {...listeners}
    >
      <Grip />
    </button>
  ) : null;
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
      {children(board, handle)}
    </div>
  );
}

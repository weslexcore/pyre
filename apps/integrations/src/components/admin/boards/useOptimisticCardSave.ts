import { type Dispatch, type SetStateAction, useRef } from 'react';
import { columnPatch } from '@/lib/boards/cards';
import { sendJson } from '@/lib/client/api';
import type { BoardCardRow, BoardColumnRow } from '@/lib/db';

export function optimisticCardPatch(
  card: BoardCardRow,
  patch: Record<string, unknown>,
  columns: BoardColumnRow[]
): BoardCardRow {
  const next = { ...card };
  const fields = {
    title: 'title',
    notesMd: 'notes_md',
    columnId: 'column_id',
    assigneeEmails: 'assignee_emails',
    dueDate: 'due_date',
    waitingOn: 'waiting_on',
    area: 'area',
  } as const;
  for (const [input, field] of Object.entries(fields)) {
    if (input in patch) Object.assign(next, { [field]: patch[input] });
  }
  if ('repeat' in patch) {
    const rule = patch.repeat as { every: number; unit: BoardCardRow['repeat_unit'] } | null;
    next.repeat_every = rule?.every ?? null;
    next.repeat_unit = rule?.unit ?? null;
  }
  // Merged, not replaced, because the route merges (normalizeProperties takes
  // the card's current answers as `previous`). A caller that names one key —
  // the calendar, dragging a date onto another day — must not blank the rest
  // of the card for the moment before the server answers.
  if (patch.properties && typeof patch.properties === 'object') {
    next.properties = { ...card.properties, ...(patch.properties as typeof card.properties) };
  }
  const column = columns.find((column) => column.id === patch.columnId);
  if (column) {
    const moved = columnPatch(card, column, '', new Date().toISOString());
    // The route keeps assignees the save names over the column's own.
    if (moved && 'assigneeEmails' in patch) delete moved.assignee_emails;
    Object.assign(next, moved);
  }
  return next;
}

/** Replace only the edited card; unrelated page data and drafts remain intact. */
export function useOptimisticCardSave<
  T extends { cards: BoardCardRow[]; columns: BoardColumnRow[] },
>(data: T | null, setData: Dispatch<SetStateAction<T | null>>) {
  const current = useRef(data);
  current.current = data;

  return async (id: string, patch: Record<string, unknown>) => {
    const before = current.current?.cards.find((card) => card.id === id);
    if (!before || !current.current) throw new Error('This card is no longer available');
    // `added` is the next copy of a repeating card the save just finished.
    const replace = (card: BoardCardRow, added?: BoardCardRow) => {
      if (!current.current) return;
      const cards = current.current.cards.map((row) => (row.id === id ? card : row));
      const next = {
        ...current.current,
        cards: added && !cards.some((row) => row.id === added.id) ? [...cards, added] : cards,
      };
      current.current = next;
      setData(next);
    };
    replace(optimisticCardPatch(before, patch, current.current.columns));
    try {
      const result = await sendJson<{ card: BoardCardRow; repeated?: BoardCardRow }>(
        '/api/admin/board-cards',
        'PATCH',
        { id, ...patch }
      );
      replace(result.card, result.repeated);
    } catch (error) {
      replace(before);
      throw error;
    }
  };
}

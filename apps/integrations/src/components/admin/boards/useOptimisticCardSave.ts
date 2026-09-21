import { type Dispatch, type SetStateAction, useRef } from 'react';
import { columnPatch } from '@/lib/boards/cards';
import type { BoardCardRow, BoardColumnRow } from '@/lib/db';
import { send } from '../goalsUi';

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
    ownerEmail: 'owner_email',
    dueDate: 'due_date',
    waitingOn: 'waiting_on',
    area: 'area',
    properties: 'properties',
  } as const;
  for (const [input, field] of Object.entries(fields)) {
    if (input in patch) Object.assign(next, { [field]: patch[input] });
  }
  const column = columns.find((column) => column.id === patch.columnId);
  if (column) Object.assign(next, columnPatch(card, column, '', new Date().toISOString()));
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
    const replace = (card: BoardCardRow) => {
      if (!current.current) return;
      const next = {
        ...current.current,
        cards: current.current.cards.map((row) => (row.id === id ? card : row)),
      };
      current.current = next;
      setData(next);
    };
    replace(optimisticCardPatch(before, patch, current.current.columns));
    try {
      const result = await send<{ card: BoardCardRow }>('/api/admin/board-cards', 'PATCH', {
        id,
        ...patch,
      });
      replace(result.card);
    } catch (error) {
      replace(before);
      throw error;
    }
  };
}

// Editing a board's columns from the board itself. Pure and client-safe.
//
// The route takes the whole column list and reconciles it by key (see
// applyColumns in api/admin/boards.ts), so renaming from a column header and
// adding one at the end of the grid are both "send the list with one thing
// changed". Keys are identity — a column keeps its id and its cards through
// a rename — which is why a new column's key is minted once from its first
// label and never recomputed.

import type { BoardColumnRow } from '@/lib/db';
import type { ColumnKind } from './types';
import { BOARD_LIMITS, KEY_RE } from './types';

/** One column as PATCH /api/admin/boards takes it. */
export interface ColumnPayload {
  key: string;
  label: string;
  kind: ColumnKind;
  archived: boolean;
  sortOrder: number;
}

/**
 * "Follow up" -> "follow_up": a machine key for a column, unique among
 * `taken`. Non-alphanumerics collapse to underscores, a key that would start
 * with a digit is prefixed, and a collision takes the next free suffix — so
 * two columns both called "New" become new and new_2, and adding "New"
 * again after retiring it never trips the unique constraint.
 */
export function columnKeyOf(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!base) base = 'column';
  if (!/^[a-z]/.test(base)) base = `c_${base}`;
  // Leave room for a "_NN" suffix inside the column-key limit.
  base = base.slice(0, BOARD_LIMITS.columnKey - 4).replace(/_+$/, '');
  if (base.length < 2) base = `${base}_col`;

  let candidate = base;
  for (let n = 2; used.has(candidate); n += 1) candidate = `${base}_${n}`;
  if (!KEY_RE.test(candidate)) throw new Error(`Could not make a column key from "${label}"`);
  return candidate;
}

/** A board's columns, in order, as the route wants them back. */
export function columnsPayload(
  columns: Pick<BoardColumnRow, 'key' | 'label' | 'kind' | 'archived' | 'sort_order'>[]
): ColumnPayload[] {
  return [...columns]
    .sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key))
    .map((column) => ({
      key: column.key,
      label: column.label,
      kind: column.kind,
      archived: column.archived,
      sortOrder: column.sort_order,
    }));
}

/** The same list with one column's label changed. */
export function renameColumn(
  columns: Pick<BoardColumnRow, 'key' | 'label' | 'kind' | 'archived' | 'sort_order'>[],
  key: string,
  label: string
): ColumnPayload[] {
  return columnsPayload(columns).map((column) =>
    column.key === key ? { ...column, label } : column
  );
}

/**
 * The same list without one column. The route decides what that means:
 * an empty column is deleted, one still holding cards is retired instead,
 * so nothing is ever stranded (applyColumns in api/admin/boards.ts).
 */
export function removeColumn(
  columns: Pick<BoardColumnRow, 'key' | 'label' | 'kind' | 'archived' | 'sort_order'>[],
  key: string
): ColumnPayload[] {
  return columnsPayload(columns).filter((column) => column.key !== key);
}

/** Whether taking `key` away would leave the board nowhere to put a card. */
export function isLastOpenColumn(
  columns: Pick<BoardColumnRow, 'key' | 'kind' | 'archived'>[],
  key: string
): boolean {
  return !columns.some(
    (column) => column.key !== key && column.kind === 'open' && !column.archived
  );
}

/** The same list with a new column after the last one. */
export function appendColumn(
  columns: Pick<BoardColumnRow, 'key' | 'label' | 'kind' | 'archived' | 'sort_order'>[],
  label: string,
  kind: ColumnKind = 'open'
): ColumnPayload[] {
  const payload = columnsPayload(columns);
  const last = payload.length > 0 ? payload[payload.length - 1].sortOrder : 0;
  return [
    ...payload,
    {
      key: columnKeyOf(
        label,
        payload.map((column) => column.key)
      ),
      label,
      kind,
      archived: false,
      sortOrder: last + 10,
    },
  ];
}

// The settings a `card_link` field has that no other field does: which board
// its cards come from, which of that board's columns a card may be picked
// from, one card or many, and whether the same links show on the other
// board as a field of its own (a two-way link).
//
// The board is chosen once. Once the field is saved it keeps it, because
// every answer names a card on that board; to link somewhere else, archive
// the field and add another (the route says the same). The pairing is made
// once too: ticking "Also show on …" creates the field over there on the
// next save, and from then on it is that board's field to rename, narrow,
// or archive in its own settings.

import { useEffect, useId, useRef } from 'react';
import { BOARD_LIMITS, isFinishedKind } from '@/lib/boards/types';
import { useCachedJson } from '@/lib/client/cachedJson';
import type { BoardColumnRow, BoardFieldRow, BoardRow } from '@/lib/db';
import { inputBaseClass, selectBaseClass } from '../goalsUi';

export interface LinkDraft {
  linkBoardId: string;
  /** Column keys on that board; empty is any column. */
  linkColumns: string[];
  linkMultiple: boolean;
  /** The far half to create on the next save; null for none. */
  linkInverse: { label: string; multiple: boolean } | null;
}

interface TargetBundle {
  board: BoardRow;
  columns: BoardColumnRow[];
  fields: BoardFieldRow[];
}

const checkLabelClass = 'flex items-center gap-1.5 text-xs text-white/60';

export function LinkFieldSettings({
  draft,
  label,
  boardName,
  boards,
  saved,
  onChange,
}: {
  draft: LinkDraft;
  /** The field's own label, for accessible names. */
  label: string;
  /** This board's name: the first guess at what the field over there is called. */
  boardName: string;
  /** Every board this manager can pick from. */
  boards: Pick<BoardRow, 'id' | 'slug' | 'name' | 'archived'>[];
  /** The field as stored, once it has been saved: fixes the board, names the pair. */
  saved: BoardFieldRow | undefined;
  onChange: (patch: Partial<LinkDraft>) => void;
}) {
  const boardSelectId = useId();
  const target = boards.find((board) => board.id === draft.linkBoardId);
  const bundle = useCachedJson<TargetBundle>(
    target ? `/api/admin/boards?slug=${encodeURIComponent(target.slug)}` : null
  );
  const columns = (bundle.data?.columns ?? []).filter(
    (column) => !column.archived || draft.linkColumns.includes(column.key)
  );
  const fixed = Boolean(saved?.link_board_id);
  const pairedWith = saved?.link_inverse_field_id
    ? bundle.data?.fields.find((field) => field.id === saved.link_inverse_field_id)
    : undefined;

  // The pair was made by a save since the target board was cached: fetch it
  // again, once, so the far field's name shows.
  const refetched = useRef(false);
  const { reload } = bundle;
  const missingPair = Boolean(saved?.link_inverse_field_id && bundle.data && !pairedWith);
  useEffect(() => {
    if (!missingPair || refetched.current) return;
    refetched.current = true;
    void reload();
  }, [missingPair, reload]);

  const toggleColumn = (key: string, on: boolean) =>
    onChange({
      linkColumns: on
        ? [...draft.linkColumns, key]
        : draft.linkColumns.filter((entry) => entry !== key),
    });

  return (
    <div className="space-y-2 rounded border border-white/10 bg-white/[0.02] p-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-white/50" htmlFor={boardSelectId}>
          Links cards on
        </label>
        <select
          id={boardSelectId}
          className={`${selectBaseClass} w-auto max-w-64 disabled:opacity-60`}
          value={draft.linkBoardId}
          disabled={fixed}
          title={fixed ? 'A saved link field keeps its board' : undefined}
          onChange={(e) =>
            onChange({ linkBoardId: e.target.value, linkColumns: [], linkInverse: null })
          }
        >
          <option value="">Choose a board…</option>
          {boards
            .filter((board) => !board.archived || board.id === draft.linkBoardId)
            .map((board) => (
              <option key={board.id} value={board.id}>
                {board.name}
              </option>
            ))}
        </select>
        <label className={checkLabelClass}>
          <input
            type="checkbox"
            checked={draft.linkMultiple}
            aria-label={`${label} can link more than one card`}
            onChange={(e) => onChange({ linkMultiple: e.target.checked })}
          />
          more than one
        </label>
      </div>

      {!draft.linkBoardId && (
        <p className="text-xs text-white/35">
          Pick a board. The field is saved once it knows where its cards come from.
        </p>
      )}

      {target && (
        <fieldset className="space-y-1">
          <legend className="text-xs text-white/50">
            Cards can be picked from{' '}
            {draft.linkColumns.length === 0 ? 'any column' : 'these columns'}:
          </legend>
          {bundle.loading ? (
            <p className="text-xs text-white/35">Loading columns…</p>
          ) : (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {columns.map((column) => (
                <label key={column.key} className={checkLabelClass}>
                  <input
                    type="checkbox"
                    checked={draft.linkColumns.includes(column.key)}
                    onChange={(e) => toggleColumn(column.key, e.target.checked)}
                  />
                  <span className={isFinishedKind(column.kind) ? 'text-white/40' : undefined}>
                    {column.label}
                  </span>
                </label>
              ))}
            </div>
          )}
          <p className="text-xs text-white/35">
            None ticked means any column. A linked card that later moves somewhere else stays
            linked.
          </p>
        </fieldset>
      )}

      {target &&
        (saved?.link_inverse_field_id ? (
          <p className="text-xs text-white/50">
            Two-way: also shown on {target.name}
            {pairedWith ? ` as “${pairedWith.label}”` : ''}. Rename or archive it in that board's
            settings.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <label className={checkLabelClass}>
              <input
                type="checkbox"
                checked={draft.linkInverse !== null}
                onChange={(e) =>
                  onChange({
                    linkInverse: e.target.checked
                      ? {
                          label: boardName.slice(0, BOARD_LIMITS.fieldLabel),
                          multiple: true,
                        }
                      : null,
                  })
                }
              />
              Also show on {target.name}
            </label>
            {draft.linkInverse && (
              <>
                <input
                  className={`${inputBaseClass} w-48`}
                  type="text"
                  maxLength={BOARD_LIMITS.fieldLabel}
                  value={draft.linkInverse.label}
                  aria-label={`Name of the field on ${target.name}`}
                  onChange={(e) =>
                    onChange({
                      linkInverse: {
                        ...(draft.linkInverse as NonNullable<LinkDraft['linkInverse']>),
                        label: e.target.value,
                      },
                    })
                  }
                />
                <label className={checkLabelClass}>
                  <input
                    type="checkbox"
                    checked={draft.linkInverse.multiple}
                    onChange={(e) =>
                      onChange({
                        linkInverse: {
                          ...(draft.linkInverse as NonNullable<LinkDraft['linkInverse']>),
                          multiple: e.target.checked,
                        },
                      })
                    }
                  />
                  more than one there
                </label>
              </>
            )}
          </div>
        ))}
    </div>
  );
}

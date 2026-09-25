// How an admin edits each kind of suggestion before approving it: the same
// fields the thing itself has (a card's board, title, notes, due date and
// custom fields; a comment's words; an SOP's text, shown as a diff against
// the document as it is now). The Record type makes a new kind in
// lib/suggestions/types a type error here until it has an editor.

import { useEffect, useState } from 'react';
import type { BoardFieldValue } from '@/lib/db';
import type {
  CardCommentPayload,
  CardCreatePayload,
  PayloadByKind,
  SopEditPayload,
  SuggestionKind,
  SuggestionResultLink,
} from '@/lib/suggestions/types';
import { SUGGESTION_LIMITS } from '@/lib/suggestions/types';
import { FieldRow } from '../guestUi';
import { inputClass, selectClass, textareaClass } from '../ShiftNoteComposer';
import { SopDiff } from '../SopDiff';
import { type BoardOption, type CurrentSop, loadBoardOptions, loadCurrentSop } from './client';

const labelClass = 'mb-1 block font-mono text-[10px] uppercase tracking-wide text-white/50';

export interface EditorProps<K extends SuggestionKind> {
  value: PayloadByKind[K];
  onChange: (next: PayloadByKind[K]) => void;
  /** The existing record it acts on (the card a comment goes on). */
  target?: SuggestionResultLink;
  disabled?: boolean;
  /** Namespaces input ids, so two suggestions on a page don't collide. */
  idPrefix: string;
}

function CardCreateEditor({
  value,
  onChange,
  disabled,
  idPrefix,
}: EditorProps<'board_card.create'>) {
  const [boards, setBoards] = useState<BoardOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadBoardOptions()
      .then((list) => {
        if (!cancelled) setBoards(list);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not load boards');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const board = boards?.find((b) => b.slug === value.board);
  const set = (patch: Partial<CardCreatePayload>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>Board</span>
          <select
            className={`${selectClass} w-full`}
            value={value.board}
            disabled={disabled || !boards}
            onChange={(e) => {
              const next = boards?.find((b) => b.slug === e.target.value);
              const keys = new Set(next?.fields.map((f) => f.key) ?? []);
              // A new board keeps only the answers its own fields can hold.
              set({
                board: e.target.value,
                columnKey: null,
                properties: Object.fromEntries(
                  Object.entries(value.properties).filter(([key]) => keys.has(key))
                ),
              });
            }}
          >
            {!board && <option value={value.board}>{value.board}</option>}
            {boards?.map((b) => (
              <option key={b.slug} value={b.slug}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Column</span>
          <select
            className={`${selectClass} w-full`}
            value={value.columnKey ?? ''}
            disabled={disabled || !board}
            onChange={(e) => set({ columnKey: e.target.value || null })}
          >
            <option value="">First open column</option>
            {board?.columns.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {loadError && <p className="font-mono text-[10px] text-[var(--pyre-red)]">{loadError}</p>}
      <label className="block">
        <span className={labelClass}>Title</span>
        <input
          className={`${inputClass} w-full`}
          value={value.title}
          maxLength={SUGGESTION_LIMITS.title}
          disabled={disabled}
          onChange={(e) => set({ title: e.target.value })}
        />
      </label>
      <label className="block">
        <span className={labelClass}>Notes</span>
        <textarea
          className={textareaClass}
          value={value.notesMd}
          maxLength={SUGGESTION_LIMITS.notes}
          disabled={disabled}
          onChange={(e) => set({ notesMd: e.target.value })}
        />
        <span className="mt-1 block font-mono text-[10px] text-white/30">
          A link back to the shift note is added when the card is created.
        </span>
      </label>
      <label className="block">
        <span className={labelClass}>Due date</span>
        <input
          type="date"
          className={inputClass}
          value={value.dueDate ?? ''}
          disabled={disabled}
          onChange={(e) => set({ dueDate: e.target.value || null })}
        />
      </label>
      {board && board.fields.length > 0 && (
        <div className="space-y-3">
          {board.fields.map((field) => (
            <FieldRow
              key={field.key}
              idPrefix={`${idPrefix}-${field.key}`}
              field={field}
              value={value.properties[field.key] as BoardFieldValue | undefined}
              onChange={(next) => {
                const properties = { ...value.properties };
                if (next === null) delete properties[field.key];
                else properties[field.key] = next;
                set({ properties });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CardCommentEditor({
  value,
  onChange,
  target,
  disabled,
}: EditorProps<'board_card.comment'>) {
  const set = (patch: Partial<CardCommentPayload>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-2">
      <p className="text-xs text-white/60">
        On{' '}
        {target?.href ? (
          <a href={target.href} className="text-[var(--pyre-gold)] underline hover:text-white">
            {target.label}
          </a>
        ) : (
          <span>{target?.label ?? 'an existing task'}</span>
        )}
      </p>
      <label className="block">
        <span className={labelClass}>Comment</span>
        <textarea
          className={textareaClass}
          value={value.note}
          maxLength={SUGGESTION_LIMITS.comment}
          disabled={disabled}
          onChange={(e) => set({ note: e.target.value })}
        />
        <span className="mt-1 block font-mono text-[10px] text-white/30">
          A link back to the shift note is added when the comment is posted.
        </span>
      </label>
    </div>
  );
}

function SopEditEditor({ value, onChange, target, disabled }: EditorProps<'sop.edit'>) {
  const [current, setCurrent] = useState<CurrentSop | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showText, setShowText] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadCurrentSop(value.sopId)
      .then((sop) => {
        if (!cancelled) setCurrent(sop);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not load the SOP');
      });
    return () => {
      cancelled = true;
    };
  }, [value.sopId]);

  const set = (patch: Partial<SopEditPayload>) => onChange({ ...value, ...patch });
  const moved = current !== null && current.current_version !== value.baseVersion;

  return (
    <div className="space-y-3">
      <p className="text-xs text-white/60">
        {target?.href ? (
          <a href={target.href} className="text-[var(--pyre-gold)] underline hover:text-white">
            {target.label}
          </a>
        ) : (
          <span>{value.title}</span>
        )}{' '}
        <span className="font-mono text-[10px] text-white/40">
          · based on v{value.baseVersion}
          {current && !moved && ' (current)'}
        </span>
      </p>
      {moved && (
        <p className="rounded border border-[var(--pyre-gold)]/40 bg-[var(--pyre-gold)]/10 px-2 py-1.5 font-mono text-[10px] text-[var(--pyre-gold)]">
          Someone saved v{current.current_version} since this was suggested. Rebase it onto the
          current version before approving.
        </p>
      )}
      {loadError && <p className="font-mono text-[10px] text-[var(--pyre-red)]">{loadError}</p>}
      {current && !moved && (
        <SopDiff before={current.content_md} after={value.contentMd} context={3} />
      )}
      <button
        type="button"
        className="font-mono text-[10px] uppercase tracking-wide text-white/50 underline hover:text-white"
        onClick={() => setShowText((on) => !on)}
      >
        {showText ? 'Hide the full text' : 'Edit the wording'}
      </button>
      {showText && (
        <textarea
          className={`${textareaClass} min-h-64 font-mono text-xs`}
          value={value.contentMd}
          maxLength={SUGGESTION_LIMITS.sopContent}
          disabled={disabled}
          onChange={(e) => set({ contentMd: e.target.value })}
        />
      )}
      <label className="block">
        <span className={labelClass}>Change note</span>
        <input
          className={`${inputClass} w-full`}
          value={value.changeNote}
          maxLength={SUGGESTION_LIMITS.changeNote}
          disabled={disabled}
          onChange={(e) => set({ changeNote: e.target.value })}
        />
      </label>
    </div>
  );
}

export const SUGGESTION_EDITORS: {
  [K in SuggestionKind]: (props: EditorProps<K>) => React.JSX.Element;
} = {
  'board_card.create': CardCreateEditor,
  'board_card.comment': CardCommentEditor,
  'sop.edit': SopEditEditor,
};

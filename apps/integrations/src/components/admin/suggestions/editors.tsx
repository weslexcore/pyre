// How an admin edits each kind of suggestion before approving it: the same
// fields the thing itself has (a card's board, assignees, title, notes, due
// date and custom fields, plus the severity and importance its due date
// follows; a comment's words; an SOP's text, shown as a diff against
// the document as it is now). The Record type makes a new kind in
// lib/suggestions/types a type error here until it has an editor.

import { todayEastern } from '@pyre/schedule-core';
import { useEffect, useState } from 'react';
import { LinkTextarea } from '@/components/admin/LinkTextarea';
import { compactInputClass, compactSelectClass } from '@/components/admin/ui';
import type { BoardFieldValue } from '@/lib/db';
import {
  describeDueDays,
  dueDateFor,
  IMPORTANCE_LABELS,
  IMPORTANCES,
  isImportance,
  isSeverity,
  SEVERITIES,
  SEVERITY_LABELS,
} from '@/lib/suggestions/priority';
import type {
  CardCommentPayload,
  CardCreatePayload,
  PayloadByKind,
  SopEditPayload,
  SuggestionKind,
  SuggestionResultLink,
} from '@/lib/suggestions/types';
import { SUGGESTION_LIMITS } from '@/lib/suggestions/types';
import { AssigneePicker } from '../boards/CardMeta';
import { FieldRow } from '../guestUi';
import { textareaClass } from '../ShiftNoteComposer';
import { SopDiff } from '../SopDiff';
import { type CardContext, type CurrentSop, loadBoardOptions, loadCurrentSop } from './client';

const labelClass = 'mb-1 block font-mono text-[10px] uppercase tracking-wide text-white/50';
const hintClass = 'mt-1 block font-mono text-[10px] text-white/40';

function sameEmails(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((email) => b.includes(email));
}

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
  const [context, setContext] = useState<CardContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadBoardOptions()
      .then((loaded) => {
        if (!cancelled) setContext(loaded);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not load boards');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const boards = context?.boards;
  const board = boards?.find((b) => b.slug === value.board);
  const set = (patch: Partial<CardCreatePayload>) => onChange({ ...value, ...patch });

  const boardDefaults = board?.default_assignee_emails ?? [];
  const nameOf = (email: string) =>
    context?.owners.find((owner) => owner.email === email)?.name ?? email;
  const assigneeHint =
    value.assigneeEmails.length === 0
      ? boardDefaults.length > 0
        ? `Nobody picked: goes to the board's default, ${boardDefaults.map(nameOf).join(', ')}.`
        : 'Unassigned. This board has no default assignee.'
      : boardDefaults.length > 0 && sameEmails(value.assigneeEmails, boardDefaults)
        ? "The board's default assignee."
        : null;

  // The due date the rating gives today, and whether the date shown is it.
  const days =
    context && (value.severity || value.importance)
      ? context.dueDays[value.severity ?? 'medium'][value.importance ?? 'medium']
      : undefined;
  const rate = (patch: Pick<Partial<CardCreatePayload>, 'severity' | 'importance'>) => {
    const next = { ...value, ...patch };
    set({
      ...patch,
      ...(context
        ? {
            dueDate: dueDateFor(next.severity, next.importance, context.dueDays, todayEastern()),
          }
        : {}),
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>Board</span>
          <select
            className={`${compactSelectClass} w-full`}
            value={value.board}
            disabled={disabled || !boards}
            onChange={(e) => {
              const next = boards?.find((b) => b.slug === e.target.value);
              const keys = new Set(next?.fields.map((f) => f.key) ?? []);
              // Still on the old board's defaults (or nobody), the card moves
              // to the new board's; anyone the admin picked stays picked.
              const assigneeEmails =
                value.assigneeEmails.length === 0 || sameEmails(value.assigneeEmails, boardDefaults)
                  ? (next?.default_assignee_emails ?? [])
                  : value.assigneeEmails;
              // A new board keeps only the answers its own fields can hold.
              set({
                board: e.target.value,
                columnKey: null,
                assigneeEmails,
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
            className={`${compactSelectClass} w-full`}
            value={value.columnKey ?? ''}
            disabled={disabled || !board}
            onChange={(e) => set({ columnKey: e.target.value || null })}
          >
            <option value="">First open column</option>
            {board?.columns
              .filter((c) => c.kind === 'open')
              .map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            {/* Already done: the card is filed there, marked complete. */}
            {board?.columns.some((c) => c.kind === 'done') && (
              <optgroup label="Already done">
                {board.columns
                  .filter((c) => c.kind === 'done')
                  .map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
              </optgroup>
            )}
          </select>
          {board?.columns.find((c) => c.key === value.columnKey)?.kind === 'done' && (
            <span className="mt-1 block font-mono text-[10px] text-white/40">
              Filed as already done: the card is marked complete.
            </span>
          )}
        </label>
      </div>
      {loadError && <p className="font-mono text-[10px] text-[var(--pyre-red)]">{loadError}</p>}
      <div>
        <span className={labelClass}>Assignees</span>
        <AssigneePicker
          owners={context?.owners ?? []}
          value={value.assigneeEmails}
          names={nameOf}
          onChange={(assigneeEmails) => set({ assigneeEmails })}
        />
        {assigneeHint && <span className={hintClass}>{assigneeHint}</span>}
      </div>
      <label className="block">
        <span className={labelClass}>Title</span>
        <input
          className={`${compactInputClass} w-full`}
          value={value.title}
          maxLength={SUGGESTION_LIMITS.title}
          disabled={disabled}
          onChange={(e) => set({ title: e.target.value })}
        />
      </label>
      <label className="block">
        <span className={labelClass}>Notes</span>
        <LinkTextarea
          className={textareaClass}
          value={value.notesMd}
          maxLength={SUGGESTION_LIMITS.notes}
          disabled={disabled}
          onChange={(next) => set({ notesMd: next })}
        />
        <span className="mt-1 block font-mono text-[10px] text-white/30">
          A link back to the shift note is added when the card is created.
        </span>
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className={labelClass}>Severity</span>
          <select
            className={`${compactSelectClass} w-full`}
            value={value.severity ?? ''}
            disabled={disabled}
            onChange={(e) => rate({ severity: isSeverity(e.target.value) ? e.target.value : null })}
          >
            <option value="">Not rated</option>
            {SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {SEVERITY_LABELS[severity]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Importance</span>
          <select
            className={`${compactSelectClass} w-full`}
            value={value.importance ?? ''}
            disabled={disabled}
            onChange={(e) =>
              rate({ importance: isImportance(e.target.value) ? e.target.value : null })
            }
          >
            <option value="">Not rated</option>
            {IMPORTANCES.map((importance) => (
              <option key={importance} value={importance}>
                {IMPORTANCE_LABELS[importance]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Due date</span>
          <input
            type="date"
            className={`${compactInputClass} w-full`}
            value={value.dueDate ?? ''}
            disabled={disabled}
            onChange={(e) => set({ dueDate: e.target.value || null })}
          />
        </label>
      </div>
      {days !== undefined && (
        <span className={hintClass}>
          {describeDueDays(days)} for this rating.{' '}
          <a href="/admin/settings" className="underline hover:text-white">
            Change the days
          </a>
        </span>
      )}
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
        <LinkTextarea
          className={textareaClass}
          value={value.note}
          maxLength={SUGGESTION_LIMITS.comment}
          disabled={disabled}
          onChange={(next) => set({ note: next })}
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
        <LinkTextarea
          className={`${textareaClass} min-h-64 font-mono text-xs`}
          value={value.contentMd}
          maxLength={SUGGESTION_LIMITS.sopContent}
          disabled={disabled}
          onChange={(next) => set({ contentMd: next })}
        />
      )}
      <label className="block">
        <span className={labelClass}>Change note</span>
        <input
          className={`${compactInputClass} w-full`}
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

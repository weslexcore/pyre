// How an admin edits each kind of suggestion before approving it: the same
// fields the thing itself has (a card's board, assignees, title, notes, due
// date and custom fields, plus the severity and importance its due date
// follows; a comment's words; an SOP's text, shown as a diff against
// the document as it is now; an assignment's hours, next to what was
// scheduled; an inventory count, next to the stock on record, on an item
// that can be swapped for another; a new inventory item's name, place and
// starting count). The Record
// type makes a new kind in lib/suggestions/types a type error here until it
// has an editor.

import { timeToMinutes, todayEastern } from '@pyre/schedule-core';
import { useEffect, useState } from 'react';
import { LinkTextarea } from '@/components/admin/LinkTextarea';
import { compactInputClass, compactSelectClass } from '@/components/admin/ui';
import { etStamp } from '@/lib/client/format';
import type { BoardFieldValue } from '@/lib/db';
import { formatQuantity, parseQuantity } from '@/lib/inventory/rules';
import { inventoryItemHref } from '@/lib/inventory/types';
import { ROLE_LABELS, SOP_ROLES } from '@/lib/sops/levels';
import { type PeopleNames, personName } from '@/lib/sops/names';
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
  InventoryCountPayload,
  InventoryCreatePayload,
  InventoryOption,
  MessageCreatePayload,
  MessageEditPayload,
  PayloadByKind,
  ShiftTimesPayload,
  SopEditPayload,
  SuggestionKind,
  SuggestionResultLink,
} from '@/lib/suggestions/types';
import { INVENTORY_ITEM_LIMITS, SUGGESTION_LIMITS } from '@/lib/suggestions/types';
import { AssigneePicker } from '../boards/CardMeta';
import { FieldRow } from '../guestUi';
import { textareaClass } from '../ShiftNoteComposer';
import { SopDiff } from '../SopDiff';
import {
  type CardContext,
  type CurrentSop,
  loadBoardOptions,
  loadCurrentSop,
  loadInventoryOptions,
} from './client';

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
  /** Names for the emails a payload carries (who counted an item). */
  names?: PeopleNames;
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
      <div>
        <label htmlFor={`${idPrefix}-notes`} className={labelClass}>
          Notes
        </label>
        <LinkTextarea
          id={`${idPrefix}-notes`}
          className={textareaClass}
          value={value.notesMd}
          maxLength={SUGGESTION_LIMITS.notes}
          disabled={disabled}
          onChange={(next) => set({ notesMd: next })}
        />
        <span className="mt-1 block font-mono text-[10px] text-white/30">
          A link back to the shift note is added when the card is created.
        </span>
      </div>
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
  idPrefix,
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
      <div>
        <label htmlFor={`${idPrefix}-comment`} className={labelClass}>
          Comment
        </label>
        <LinkTextarea
          id={`${idPrefix}-comment`}
          className={textareaClass}
          value={value.note}
          maxLength={SUGGESTION_LIMITS.comment}
          disabled={disabled}
          onChange={(next) => set({ note: next })}
        />
        <span className="mt-1 block font-mono text-[10px] text-white/30">
          A link back to the shift note is added when the comment is posted.
        </span>
      </div>
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

/** "+0.5h" — how far the new hours move the assignment's total. */
function hoursDelta(value: ShiftTimesPayload): string | null {
  if (!value.scheduledStartsAt || !value.scheduledEndsAt || value.endsAt <= value.startsAt) {
    return null;
  }
  const minutes =
    timeToMinutes(value.endsAt) -
    timeToMinutes(value.startsAt) -
    (timeToMinutes(value.scheduledEndsAt) - timeToMinutes(value.scheduledStartsAt));
  if (minutes === 0) return null;
  const hours = Math.round((minutes / 60) * 100) / 100;
  return `${hours > 0 ? '+' : ''}${hours}h`;
}

function ShiftTimesEditor({
  value,
  onChange,
  target,
  disabled,
  idPrefix,
}: EditorProps<'shift_assignment.update'>) {
  const set = (patch: Partial<ShiftTimesPayload>) => onChange({ ...value, ...patch });
  const delta = hoursDelta(value);
  return (
    <div className="space-y-2">
      <p className="text-xs text-white/60">
        {target?.href ? (
          <a href={target.href} className="text-[var(--pyre-gold)] underline hover:text-white">
            {target.label}
          </a>
        ) : (
          <span>
            {target?.label ?? `${value.staffName} on ${value.shiftLabel}, ${value.shiftDate}`}
          </span>
        )}
        {value.scheduledStartsAt && (
          <span className="font-mono text-[10px] text-white/40">
            {' '}
            · scheduled {value.scheduledStartsAt}–{value.scheduledEndsAt}
          </span>
        )}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={`${idPrefix}-starts`} className={labelClass}>
            Started
          </label>
          <input
            id={`${idPrefix}-starts`}
            type="time"
            className={compactInputClass}
            value={value.startsAt}
            disabled={disabled}
            onChange={(e) => e.target.value && set({ startsAt: e.target.value.slice(0, 5) })}
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-ends`} className={labelClass}>
            Finished
          </label>
          <input
            id={`${idPrefix}-ends`}
            type="time"
            className={compactInputClass}
            value={value.endsAt}
            disabled={disabled}
            onChange={(e) => e.target.value && set({ endsAt: e.target.value.slice(0, 5) })}
          />
        </div>
        {delta && <span className="pb-1.5 font-mono text-xs text-white/60">{delta}</span>}
      </div>
      {value.endsAt <= value.startsAt && (
        <p className="font-mono text-[10px] text-[var(--pyre-red)]">
          The finish has to be after the start, on the same day.
        </p>
      )}
      <span className={hintClass}>
        Changes this person's hours on the shift, which is what the timesheet pays.
      </span>
    </div>
  );
}

/** The active inventory items, loaded once per page; null until they arrive. */
export function useInventoryOptions(): { items: InventoryOption[] | null; error: string | null } {
  const [items, setItems] = useState<InventoryOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadInventoryOptions()
      .then((loaded) => {
        if (!cancelled) setItems(loaded);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the inventory');
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return { items, error };
}

/**
 * A count moved onto another item: the item's own name, stock on record and
 * last count come with it, so the editor (and the delta) read against the
 * item it now counts.
 */
export function recountOn(
  value: InventoryCountPayload,
  item: InventoryOption
): InventoryCountPayload {
  return {
    ...value,
    itemId: item.id,
    itemName: item.name,
    previousInStock: item.in_stock,
    reorderAt: item.reorder_at,
    lastCountedAt: item.last_counted_at,
    lastCountedBy: item.last_counted_by,
  };
}

/** Which item a count is on: the agent's pick, changeable to any active item. */
export function InventoryItemPicker({
  value,
  items,
  onPick,
  disabled,
  id,
  className = '',
}: {
  value: Pick<InventoryCountPayload, 'itemId' | 'itemName'>;
  items: InventoryOption[] | null;
  onPick: (item: InventoryOption) => void;
  disabled?: boolean;
  id: string;
  className?: string;
}) {
  const listed = items?.some((item) => item.id === value.itemId) ?? false;
  return (
    <select
      id={id}
      className={`${compactSelectClass} ${className}`}
      value={value.itemId}
      disabled={disabled || !items}
      onChange={(e) => {
        const next = items?.find((item) => item.id === e.target.value);
        if (next) onPick(next);
      }}
    >
      {!listed && <option value={value.itemId}>{value.itemName || 'This item'}</option>}
      {(items ?? []).map((item) => (
        <option key={item.id} value={item.id}>
          {item.name}
          {item.category ? ` · ${item.category}` : ''}
        </option>
      ))}
    </select>
  );
}

/** '+3' / '−2' between what is on record and the count, or null when there is none. */
export function stockDelta(previous: number | null, next: number | null): string | null {
  if (previous === null || next === null || previous === next) return null;
  const delta = next - previous;
  return delta > 0 ? `+${formatQuantity(delta)}` : `−${formatQuantity(-delta)}`;
}

/**
 * A count read out of a note: the number, on an item the admin can swap for
 * another, next to what the list says now and who last counted it. The count
 * is recorded as the note author's, at the note's time, so the admin sees
 * whose look at the shelf they are approving — and whether someone has
 * counted it since the note.
 */
function InventoryCountEditor({
  value,
  onChange,
  disabled,
  idPrefix,
  names,
}: EditorProps<'inventory.count'>) {
  const { items, error: loadError } = useInventoryOptions();
  // The box keeps what the admin types; the payload takes it once it parses.
  const [text, setText] = useState(formatQuantity(value.inStock));
  useEffect(() => {
    setText(formatQuantity(value.inStock));
  }, [value.inStock]);
  const parsed = parseQuantity(text);
  const delta = stockDelta(value.previousInStock, parsed);
  const countedSince =
    value.countedAt !== null &&
    value.lastCountedAt !== null &&
    Date.parse(value.lastCountedAt) > Date.parse(value.countedAt);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor={`${idPrefix}-item`} className={labelClass}>
            Item
          </label>
          <InventoryItemPicker
            id={`${idPrefix}-item`}
            className="w-full"
            value={value}
            items={items}
            disabled={disabled}
            onPick={(item) => onChange(recountOn(value, item))}
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-count`} className={labelClass}>
            In stock
          </label>
          <input
            id={`${idPrefix}-count`}
            inputMode="decimal"
            className={`${compactInputClass} w-28 text-right tabular-nums`}
            value={text}
            disabled={disabled}
            aria-invalid={parsed === null || undefined}
            onChange={(e) => {
              setText(e.target.value);
              const next = parseQuantity(e.target.value);
              if (next !== null) onChange({ ...value, inStock: next });
            }}
          />
        </div>
        {delta && <span className="pb-1.5 font-mono text-xs text-white/60">{delta}</span>}
      </div>
      <p className="font-mono text-[10px] text-white/40">
        <a
          href={inventoryItemHref(value.itemId)}
          className="text-[var(--pyre-gold)] underline hover:text-white"
        >
          {value.itemName || 'Open the item'}
        </a>
        {value.previousInStock !== null && (
          <>
            {' '}
            · {formatQuantity(value.previousInStock)} on record
            {value.reorderAt !== null && `, re-order at ${formatQuantity(value.reorderAt)}`}
          </>
        )}
      </p>
      {loadError && (
        <p className="font-mono text-[10px] text-[var(--pyre-red)]">
          Couldn’t load the other items to switch to ({loadError}).
        </p>
      )}
      {parsed === null && (
        <p className="font-mono text-[10px] text-[var(--pyre-red)]">
          In stock must be a number from 0 to 100000.
        </p>
      )}
      <span className={hintClass}>
        {value.countedBy
          ? `Recorded as counted by ${personName(value.countedBy, names)}${
              value.countedAt ? ` on ${etStamp(value.countedAt)}` : ''
            }, with a link back to where it was read.`
          : 'Recorded as a count read from the shift note, with a link back to it.'}
        {value.lastCountedAt &&
          ` Last counted ${etStamp(value.lastCountedAt)}${
            value.lastCountedBy ? ` by ${personName(value.lastCountedBy, names)}` : ''
          }.`}
      </span>
      {countedSince && (
        <p className="rounded border border-[var(--pyre-gold)]/40 bg-[var(--pyre-gold)]/10 px-2 py-1.5 font-mono text-[10px] text-[var(--pyre-gold)]">
          Someone counted this item after the note was written. Approving replaces their count with
          the note's.
        </p>
      )}
    </div>
  );
}

/** An optional quantity box: keeps the text as typed, hands up the number (or null when empty). */
export function QuantityInput({
  id,
  value,
  onChange,
  disabled,
  className = 'w-24',
  placeholder,
  label,
  onValidity,
}: {
  id: string;
  value: number | null;
  onChange: (next: number | null) => void;
  /** Hears whether the text as typed is a quantity (or empty). */
  onValidity?: (valid: boolean) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  /** For a box without a visible label (a table cell). */
  label?: string;
}) {
  const shown = value === null ? '' : formatQuantity(value);
  const [text, setText] = useState(shown);
  useEffect(() => {
    setText((current) => {
      const typed = current.trim() === '' ? null : parseQuantity(current);
      return typed === value ? current : shown;
    });
  }, [value, shown]);
  const invalid = text.trim() !== '' && parseQuantity(text) === null;
  return (
    <input
      id={id}
      inputMode="decimal"
      aria-label={label}
      className={`${compactInputClass} ${className} text-right tabular-nums`}
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value.trim() === '') {
          onValidity?.(true);
          onChange(null);
        } else {
          const next = parseQuantity(e.target.value);
          onValidity?.(next !== null);
          if (next !== null) onChange(next);
        }
      }}
    />
  );
}

/**
 * A supply the inventory doesn't track yet: its name, where it is kept and
 * how many there are, as the note gave them — each editable, and the rest
 * (cost, how to order) filled in on the list afterwards.
 */
function InventoryCreateEditor({
  value,
  onChange,
  disabled,
  idPrefix,
  names,
}: EditorProps<'inventory.create'>) {
  const set = (patch: Partial<InventoryCreatePayload>) => onChange({ ...value, ...patch });
  const textField = (
    key: 'name' | 'category' | 'location' | 'vendor',
    label: string,
    placeholder?: string
  ) => (
    <div>
      <label htmlFor={`${idPrefix}-${key}`} className={labelClass}>
        {label}
      </label>
      <input
        id={`${idPrefix}-${key}`}
        className={`${compactInputClass} w-full`}
        value={value[key] ?? ''}
        placeholder={placeholder}
        maxLength={INVENTORY_ITEM_LIMITS[key]}
        disabled={disabled}
        onChange={(e) => set({ [key]: e.target.value })}
      />
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {textField('name', 'Name')}
        {textField('category', 'Category', 'e.g. Cleaning')}
        {textField('location', 'Kept at', 'e.g. Front desk')}
        {textField('vendor', 'Vendor')}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={`${idPrefix}-count`} className={labelClass}>
            In stock
          </label>
          <QuantityInput
            id={`${idPrefix}-count`}
            value={value.inStock}
            placeholder="not counted"
            className="w-28"
            disabled={disabled}
            onChange={(inStock) => set({ inStock })}
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-reorder`} className={labelClass}>
            Re-order at
          </label>
          <QuantityInput
            id={`${idPrefix}-reorder`}
            value={value.reorderAt}
            placeholder="never"
            className="w-28"
            disabled={disabled}
            onChange={(reorderAt) => set({ reorderAt })}
          />
        </div>
      </div>
      <span className={hintClass}>
        Approving adds it to the inventory as yours.
        {value.inStock !== null &&
          (value.countedBy
            ? ` Its first count is recorded as ${personName(value.countedBy, names)}'s${
                value.countedAt ? `, on ${etStamp(value.countedAt)}` : ''
              }, with a link back to where it was read.`
            : ' Its first count links back to the shift note.')}{' '}
        Cost and how to order are set on the inventory list.
      </span>
    </div>
  );
}

/** A new admin message: its words, who it is for, and whether they must acknowledge it. */
function MessageCreateEditor({
  value,
  onChange,
  disabled,
  idPrefix,
  names,
}: EditorProps<'message.create'>) {
  const set = (patch: Partial<MessageCreatePayload>) => onChange({ ...value, ...patch });
  const toggleRole = (role: (typeof SOP_ROLES)[number]) =>
    set({
      audienceRoles: value.audienceRoles.includes(role)
        ? value.audienceRoles.filter((r) => r !== role)
        : [...value.audienceRoles, role],
    });
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`${idPrefix}-title`} className={labelClass}>
          Title
        </label>
        <input
          id={`${idPrefix}-title`}
          className={`${compactInputClass} w-full`}
          value={value.title}
          maxLength={SUGGESTION_LIMITS.messageTitle}
          disabled={disabled}
          onChange={(e) => set({ title: e.target.value })}
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-body`} className={labelClass}>
          Message
        </label>
        <LinkTextarea
          id={`${idPrefix}-body`}
          className={`${textareaClass} min-h-40`}
          value={value.bodyMd}
          maxLength={SUGGESTION_LIMITS.messageBody}
          disabled={disabled}
          onChange={(next) => set({ bodyMd: next })}
        />
      </div>
      <fieldset>
        <legend className={labelClass}>For</legend>
        <div className="flex flex-wrap gap-3">
          {SOP_ROLES.map((role) => (
            <label key={role} className="flex items-center gap-1.5 text-xs text-white/70">
              <input
                type="checkbox"
                checked={value.audienceRoles.includes(role)}
                disabled={disabled}
                onChange={() => toggleRole(role)}
              />
              {ROLE_LABELS[role]}
            </label>
          ))}
        </div>
        {value.audienceEmails.length > 0 && (
          <span className={hintClass}>
            And {value.audienceEmails.map((email) => personName(email, names ?? {})).join(', ')}
          </span>
        )}
      </fieldset>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-1.5 text-xs text-white/70">
          <input
            type="checkbox"
            checked={value.requiresAck}
            disabled={disabled}
            onChange={(e) => set({ requiresAck: e.target.checked })}
          />
          Ask them to acknowledge it
        </label>
        <label className="flex items-center gap-1.5 text-xs text-white/70">
          <input
            type="checkbox"
            checked={value.pinned}
            disabled={disabled}
            onChange={(e) => set({ pinned: e.target.checked })}
          />
          Pin it
        </label>
      </div>
      <span className={hintClass}>
        Approving saves it as your draft. Nobody is told until you send it from Messages.
      </span>
    </div>
  );
}

/** New wording for an existing message, shown as a diff against how it reads now. */
function MessageEditEditor({
  value,
  onChange,
  target,
  disabled,
  idPrefix,
}: EditorProps<'message.edit'>) {
  const [showText, setShowText] = useState(false);
  const set = (patch: Partial<MessageEditPayload>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3">
      <p className="text-xs text-white/60">
        {target?.href ? (
          <a href={target.href} className="text-[var(--pyre-gold)] underline hover:text-white">
            {target.label}
          </a>
        ) : (
          <span>{value.previousTitle || value.title}</span>
        )}{' '}
        <span className="font-mono text-[10px] text-white/40">
          · {value.sent ? 'sent' : 'draft'}
        </span>
      </p>
      <div>
        <label htmlFor={`${idPrefix}-title`} className={labelClass}>
          Title
        </label>
        <input
          id={`${idPrefix}-title`}
          className={`${compactInputClass} w-full`}
          value={value.title}
          maxLength={SUGGESTION_LIMITS.messageTitle}
          disabled={disabled}
          onChange={(e) => set({ title: e.target.value })}
        />
        {value.previousTitle && value.previousTitle !== value.title && (
          <span className={hintClass}>Was: {value.previousTitle}</span>
        )}
      </div>
      <SopDiff before={value.previousBodyMd} after={value.bodyMd} context={3} />
      <button
        type="button"
        className="font-mono text-[10px] uppercase tracking-wide text-white/50 underline hover:text-white"
        onClick={() => setShowText((on) => !on)}
      >
        {showText ? 'Hide the full text' : 'Edit the wording'}
      </button>
      {showText && (
        <LinkTextarea
          className={`${textareaClass} min-h-48`}
          value={value.bodyMd}
          maxLength={SUGGESTION_LIMITS.messageBody}
          disabled={disabled}
          onChange={(next) => set({ bodyMd: next })}
        />
      )}
      {value.sent && (
        <span className={hintClass}>
          Approving saves the new wording on the sent message. Anyone it newly @-mentions is told.
        </span>
      )}
    </div>
  );
}

export const SUGGESTION_EDITORS: {
  [K in SuggestionKind]: (props: EditorProps<K>) => React.JSX.Element;
} = {
  'board_card.create': CardCreateEditor,
  'board_card.comment': CardCommentEditor,
  'sop.edit': SopEditEditor,
  'shift_assignment.update': ShiftTimesEditor,
  'inventory.count': InventoryCountEditor,
  'inventory.create': InventoryCreateEditor,
  'message.create': MessageCreateEditor,
  'message.edit': MessageEditEditor,
};

// One card, opened. A bottom sheet on a phone and a right-hand panel on a
// desk, holding everything a row cannot: the notes, the board's own fields,
// and the thread. No goal picker: a card is filed under its board's goal.
//
// Edits save automatically; text is debounced and writes are serialized.

import { useEffect, useId, useRef, useState } from 'react';
import { BOARD_LIMITS } from '@/lib/boards/types';
import type { BoardCardRow, BoardColumnRow, BoardFieldRow, BoardFieldValue } from '@/lib/db';
import { AREAS } from '@/lib/goals/types';
import type { PeopleNames } from '@/lib/sops/names';
import { ConfirmDialog } from '../ConfirmDialog';
import { ActivityFeed } from '../goals/ActivityFeed';
import {
  buttonClass,
  dangerButtonClass,
  inputClass,
  labelClass,
  selectClass,
  textareaClass,
} from '../goalsUi';
import { FieldRow } from '../guestUi';
import { SopMarkdown } from '../SopMarkdown';
import { useCardAutosave } from './useCardAutosave';

export interface CardDrawerProps {
  card: BoardCardRow;
  columns: BoardColumnRow[];
  fields: BoardFieldRow[];
  people: PeopleNames;
  /** Everyone who can own a card, by email. */
  owners: { email: string; name: string }[];
  busy?: boolean;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}

export function CardDrawer({
  card,
  columns,
  fields,
  people,
  owners,
  busy = false,
  onSave,
  onDelete,
  onClose,
}: CardDrawerProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  const [title, setTitle] = useState(card.title);
  const [notes, setNotes] = useState(card.notes_md);
  const [columnId, setColumnId] = useState(card.column_id);
  const [ownerEmail, setOwnerEmail] = useState(card.owner_email ?? '');
  const [dueDate, setDueDate] = useState(card.due_date ?? '');
  const [waitingOn, setWaitingOn] = useState(card.waiting_on ?? '');
  const [area, setArea] = useState(card.area ?? '');
  const [properties, setProperties] = useState<Record<string, BoardFieldValue>>(card.properties);
  const [preview, setPreview] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const autosave = useCardAutosave(onSave);
  const saving = autosave.status === 'saving' || autosave.status === 'pending';
  const error = !title.trim() ? 'A card needs a title.' : autosave.error;
  const close = async () => {
    if (!title.trim()) return;
    if (await autosave.flush()) onClose();
  };
  const closeAction = useRef(close);
  closeAction.current = close;

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void closeAction.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const liveColumns = columns.filter((c) => !c.archived || c.id === card.column_id);
  const liveFields = fields.filter((f) => !f.archived || properties[f.key] != null);
  const finished = card.completed_at !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end overflow-y-auto sm:items-stretch">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close"
        onClick={() => void close()}
        className="absolute inset-0 h-full w-full cursor-default bg-black/70"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-lg border border-white/15 bg-[var(--pyre-black)] p-4 shadow-xl sm:max-h-none sm:max-w-lg sm:rounded-none sm:rounded-l-lg"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id={titleId} className="font-mono text-xs uppercase tracking-wide text-white/50">
            {finished ? 'Finished card' : 'Card'}
          </h2>
          <button ref={closeRef} type="button" className={buttonClass} onClick={() => void close()}>
            Close
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className={labelClass} htmlFor={`card-title-${card.id}`}>
              Title
            </label>
            <input
              id={`card-title-${card.id}`}
              className={inputClass}
              type="text"
              maxLength={BOARD_LIMITS.title}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (e.target.value.trim()) autosave.schedule({ title: e.target.value }, 600);
              }}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor={`card-column-${card.id}`}>
                Column
              </label>
              <select
                id={`card-column-${card.id}`}
                className={selectClass}
                value={columnId}
                onChange={(e) => {
                  setColumnId(e.target.value);
                  autosave.schedule({ columnId: e.target.value }, 0);
                }}
              >
                {liveColumns.map((column) => (
                  <option key={column.id} value={column.id}>
                    {column.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass} htmlFor={`card-owner-${card.id}`}>
                Owner
              </label>
              <select
                id={`card-owner-${card.id}`}
                className={selectClass}
                value={ownerEmail}
                onChange={(e) => {
                  setOwnerEmail(e.target.value);
                  autosave.schedule({ ownerEmail: e.target.value || null }, 0);
                }}
              >
                <option value="">Unassigned</option>
                {owners.map((owner) => (
                  <option key={owner.email} value={owner.email}>
                    {owner.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass} htmlFor={`card-due-${card.id}`}>
                Due
              </label>
              <input
                id={`card-due-${card.id}`}
                className={inputClass}
                type="date"
                value={dueDate}
                onChange={(e) => {
                  setDueDate(e.target.value);
                  autosave.schedule({ dueDate: e.target.value || null }, 0);
                }}
              />
            </div>

            <div>
              <label className={labelClass} htmlFor={`card-area-${card.id}`}>
                Area
              </label>
              <select
                id={`card-area-${card.id}`}
                className={selectClass}
                value={area}
                onChange={(e) => {
                  setArea(e.target.value);
                  autosave.schedule({ area: e.target.value || null }, 0);
                }}
              >
                <option value="">None</option>
                {AREAS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass} htmlFor={`card-waiting-${card.id}`}>
              Waiting on
            </label>
            <input
              id={`card-waiting-${card.id}`}
              className={inputClass}
              type="text"
              maxLength={BOARD_LIMITS.waitingOn}
              placeholder="Sarah's availability, the insurer, a quote…"
              value={waitingOn}
              onChange={(e) => {
                setWaitingOn(e.target.value);
                autosave.schedule({ waitingOn: e.target.value || null }, 600);
              }}
            />
            <p className="mt-1 text-xs text-white/35">
              The card stays where it is; the badge says why it is stuck.
            </p>
          </div>

          {liveFields.length > 0 && (
            <div className="space-y-3 border-t border-white/10 pt-4">
              {liveFields.map((field) => (
                <FieldRow
                  key={field.key}
                  idPrefix={`card-${card.id}`}
                  field={field}
                  value={properties[field.key]}
                  onChange={(next) => {
                    const updated = { ...properties };
                    if (next === null) delete updated[field.key];
                    else updated[field.key] = next;
                    setProperties(updated);
                    autosave.schedule({ properties: updated });
                  }}
                />
              ))}
            </div>
          )}

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className={`${labelClass} mb-0`}>Notes</span>
              <button type="button" className={buttonClass} onClick={() => setPreview((on) => !on)}>
                {preview ? 'Edit' : 'Preview'}
              </button>
            </div>
            {preview ? (
              <div className="rounded border border-white/10 bg-white/[0.03] p-3">
                {notes.trim() ? (
                  <SopMarkdown content={notes} />
                ) : (
                  <p className="font-mono text-xs text-white/35">Nothing written yet.</p>
                )}
              </div>
            ) : (
              <textarea
                className={textareaClass}
                maxLength={BOARD_LIMITS.notes}
                placeholder="Markdown is fine here."
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  autosave.schedule({ notesMd: e.target.value }, 600);
                }}
              />
            )}
          </div>

          {error && <p className="text-sm text-[var(--pyre-red)]">{error}</p>}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-4">
            <button
              type="button"
              className={dangerButtonClass}
              disabled={busy || saving}
              onClick={() => setConfirming(true)}
            >
              Delete
            </button>
            <div className="flex items-center gap-2">
              <span role="status" className="text-xs text-white/50">
                {error ? 'Changes not saved' : saving ? 'Saving…' : 'All changes saved'}
              </span>
              {autosave.error && (
                <button type="button" className={buttonClass} onClick={() => void autosave.flush()}>
                  Retry
                </button>
              )}
            </div>
          </div>

          <div className="border-t border-white/10 pt-4">
            <ActivityFeed
              cardId={card.id}
              subjectTitle={card.title}
              columns={columns}
              people={people}
            />
          </div>
        </div>
      </div>

      {confirming && (
        <ConfirmDialog
          title="Delete this card?"
          body="The card and its history go with it. If the work simply did not happen, move it to a dropped column instead — that keeps the record."
          confirmLabel="Delete"
          danger
          busy={busy || saving}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void onDelete();
          }}
        />
      )}
    </div>
  );
}

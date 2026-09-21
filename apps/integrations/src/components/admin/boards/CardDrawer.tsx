// One card, opened. A bottom sheet on a phone and a right-hand panel on a
// desk, holding everything a row cannot: the notes, the goal it is filed
// under, the board's own fields, and the thread.
//
// Saving is explicit rather than per-keystroke — this is the panel where
// somebody writes a paragraph, and autosaving a half-written sentence into
// an audit trail everyone reads would be worse than a Save button. The
// column select and the delete are the exceptions: both are single decisions
// with nothing to lose.

import { useEffect, useId, useRef, useState } from 'react';
import { BOARD_LIMITS } from '@/lib/boards/types';
import type {
  BoardCardRow,
  BoardColumnRow,
  BoardFieldRow,
  BoardFieldValue,
  GoalRow,
} from '@/lib/db';
import { AREAS } from '@/lib/goals/types';
import type { PeopleNames } from '@/lib/sops/names';
import { ConfirmDialog } from '../ConfirmDialog';
import { ActivityFeed } from '../goals/ActivityFeed';
import {
  buttonClass,
  dangerButtonClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  selectClass,
  textareaClass,
} from '../goalsUi';
import { FieldRow } from '../guestUi';
import { SopMarkdown } from '../SopMarkdown';

export interface CardDrawerProps {
  card: BoardCardRow;
  columns: BoardColumnRow[];
  fields: BoardFieldRow[];
  /** Goals the card may be filed under; empty hides the picker entirely. */
  goals: GoalRow[];
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
  goals,
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
  const [goalId, setGoalId] = useState(card.goal_id ?? '');
  const [area, setArea] = useState(card.area ?? '');
  const [properties, setProperties] = useState<Record<string, BoardFieldValue>>(card.properties);
  const [preview, setPreview] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed when the drawer is pointed at a different card without closing.
  useEffect(() => {
    setTitle(card.title);
    setNotes(card.notes_md);
    setColumnId(card.column_id);
    setOwnerEmail(card.owner_email ?? '');
    setDueDate(card.due_date ?? '');
    setWaitingOn(card.waiting_on ?? '');
    setGoalId(card.goal_id ?? '');
    setArea(card.area ?? '');
    setProperties(card.properties);
    setError(null);
  }, [card]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const liveColumns = columns.filter((c) => !c.archived || c.id === card.column_id);
  const liveFields = fields.filter((f) => !f.archived || properties[f.key] != null);
  const finished = card.completed_at !== null;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        title,
        notesMd: notes,
        columnId,
        ownerEmail: ownerEmail || null,
        dueDate: dueDate || null,
        waitingOn: waitingOn || null,
        goalId: goalId || null,
        area: area || null,
        properties,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end overflow-y-auto sm:items-stretch">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close"
        onClick={onClose}
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
          <button ref={closeRef} type="button" className={buttonClass} onClick={onClose}>
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
              onChange={(e) => setTitle(e.target.value)}
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
                onChange={(e) => setColumnId(e.target.value)}
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
                onChange={(e) => setOwnerEmail(e.target.value)}
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
                onChange={(e) => setDueDate(e.target.value)}
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
                onChange={(e) => setArea(e.target.value)}
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
              onChange={(e) => setWaitingOn(e.target.value)}
            />
            <p className="mt-1 text-xs text-white/35">
              The card stays where it is; the badge says why it is stuck.
            </p>
          </div>

          {goals.length > 0 && (
            <div>
              <label className={labelClass} htmlFor={`card-goal-${card.id}`}>
                Goal
              </label>
              <select
                id={`card-goal-${card.id}`}
                className={selectClass}
                value={goalId}
                onChange={(e) => setGoalId(e.target.value)}
              >
                <option value="">Not filed under a goal</option>
                {goals.map((goal) => (
                  <option key={goal.id} value={goal.id}>
                    {goal.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {liveFields.length > 0 && (
            <div className="space-y-3 border-t border-white/10 pt-4">
              {liveFields.map((field) => (
                <FieldRow
                  key={field.key}
                  idPrefix={`card-${card.id}`}
                  field={field}
                  value={properties[field.key]}
                  onChange={(next) =>
                    setProperties((current) => {
                      const updated = { ...current };
                      if (next === null) delete updated[field.key];
                      else updated[field.key] = next;
                      return updated;
                    })
                  }
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
                onChange={(e) => setNotes(e.target.value)}
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
            <div className="flex gap-2">
              <button type="button" className={buttonClass} onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className={primaryButtonClass}
                disabled={busy || saving || !title.trim()}
                onClick={() => void save()}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
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

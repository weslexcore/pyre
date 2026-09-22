// One card, opened. A bottom sheet on a phone and a right-hand panel on a
// desk, holding everything a row cannot: the notes, the board's own fields,
// and the thread. No goal picker: a card is filed under its board's goal.
//
// Edits save automatically; text is debounced and writes are serialized.

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BOARD_LIMITS, isFinishedKind } from '@/lib/boards/types';
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
import { useSheetSwipe } from '../useSheetSwipe';
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
  const panelRef = useRef<HTMLDivElement>(null);
  const closeInProgress = useRef(false);
  const [closing, setClosing] = useState(false);

  const [title, setTitle] = useState(card.title);
  const [notes, setNotes] = useState(card.notes_md);
  const [columnId, setColumnId] = useState(card.column_id);
  const [ownerEmail, setOwnerEmail] = useState(card.owner_email ?? '');
  const [dueDate, setDueDate] = useState(card.due_date ?? '');
  const [waitingOn, setWaitingOn] = useState(card.waiting_on ?? '');
  const [area, setArea] = useState(card.area ?? '');
  const [properties, setProperties] = useState<Record<string, BoardFieldValue | null>>(
    card.properties
  );
  const [preview, setPreview] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const autosave = useCardAutosave(onSave);
  const saving = autosave.status === 'saving' || autosave.status === 'pending';
  const error = !title.trim() ? 'A card needs a title.' : autosave.error;
  const close = async () => {
    if (!title.trim() || closeInProgress.current) return;
    closeInProgress.current = true;
    try {
      if (!(await autosave.flush())) return;
      setClosing(true);
      // Reverse the actual entry animation, including its current position if
      // closed mid-entry. Reduced motion has no animation, so closes immediately.
      const animation = panelRef.current
        ?.getAnimations()
        .find(
          (animation) =>
            animation instanceof CSSAnimation &&
            animation.animationName.startsWith('card-drawer-open-')
        );
      if (animation) {
        animation.reverse();
        const duration = animation.effect?.getComputedTiming().duration;
        if (typeof duration === 'number' && duration > 0) {
          // A full exit takes 300ms; reversing mid-entry covers less distance.
          animation.updatePlaybackRate(-duration / 300);
        }
        // A breakpoint or reduced-motion change can cancel the animation.
        await animation.finished.catch(() => undefined);
      }
      onClose();
    } finally {
      closeInProgress.current = false;
    }
  };
  const closeAction = useRef(close);
  closeAction.current = close;

  useEffect(() => {
    // Focusing a moving panel must not scroll it into view mid-animation.
    closeRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void closeAction.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // On a phone, pulling the sheet down closes it the way Close does: the
  // edits are flushed while it slides away, and a save that fails (or a
  // title left empty) brings it back with the reason showing.
  useSheetSwipe(panelRef, {
    enabled: !closing,
    requestClose: async () => {
      if (!title.trim() || closeInProgress.current) return false;
      closeInProgress.current = true;
      setClosing(true);
      if (await autosave.flush()) return true;
      setClosing(false);
      closeInProgress.current = false;
      return false;
    },
    onClosed: onClose,
  });

  const liveColumns = columns.filter((c) => !c.archived || c.id === card.column_id);
  const liveFields = fields.filter((f) => !f.archived || properties[f.key] != null);
  const finished = card.completed_at !== null;

  if (typeof document === 'undefined') return null;

  // Keep the viewport overlay outside the board's spacing and scroll containers.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-end overflow-clip sm:items-stretch">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close"
        disabled={closing}
        onClick={() => void close()}
        className="absolute inset-0 h-full w-full cursor-default bg-black/70"
      />
      <div
        ref={panelRef}
        inert={closing}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="card-drawer-panel relative max-h-[92vh] w-full overflow-x-hidden overflow-y-auto overscroll-contain rounded-t-lg border border-white/15 bg-[var(--pyre-black)] p-4 shadow-xl sm:max-h-none sm:max-w-lg sm:rounded-none sm:rounded-l-lg"
      >
        {/* The grip that says the sheet can be pulled down; on a desk it is a
            side panel, and under a pointer there is nothing to pull. */}
        <div
          aria-hidden="true"
          className="touch-only mx-auto mb-3 h-1 w-9 rounded-full bg-white/25 sm:hidden"
        />
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
              className={`${inputClass} ${finished ? 'text-white/40 line-through' : ''}`}
              type="text"
              maxLength={BOARD_LIMITS.title}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (e.target.value.trim()) autosave.schedule({ title: e.target.value }, 600);
                else autosave.discard('title');
              }}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                  const destination = columns.find((column) => column.id === e.target.value);
                  if (destination && isFinishedKind(destination.kind)) {
                    setWaitingOn('');
                    autosave.schedule({ columnId: e.target.value, waitingOn: null }, 0);
                  } else {
                    autosave.schedule({ columnId: e.target.value }, 0);
                  }
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
                    // Explicit null clears a saved answer; omitted keys are preserved by PATCH.
                    updated[field.key] = next;
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
    </div>,
    document.body
  );
}

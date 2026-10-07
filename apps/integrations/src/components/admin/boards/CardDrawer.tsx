// One card, opened. A bottom sheet on a phone and a right-hand panel on a
// desk, holding everything a row cannot: the notes, the board's own fields,
// and the thread. No goal picker: a card is filed under its board's goal,
// and no area picker: the board says what area the work is in.
//
// The title is the heading, edited where it stands; status, assignees, the
// due date (and its repeat), and what the card waits on are quiet chips
// under it (CardMeta), so the first screen is the card's body.
//
// Edits save automatically; text is debounced and writes are serialized.

import { navigate } from 'astro:transitions/client';
import { todayEastern } from '@pyre/schedule-core';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formButtonClass } from '@/components/admin/ui';
import { type AttachmentSummary, adminAttachmentHref, fileIdsOf } from '@/lib/boards/files';
import { type LinkSummary, linkIdsOf } from '@/lib/boards/links';
import { type RepeatRule, repeatRuleOf } from '@/lib/boards/recurrence';
import { BOARD_LIMITS, isFinishedKind } from '@/lib/boards/types';
import type { BoardCardRow, BoardColumnRow, BoardFieldRow, BoardFieldValue } from '@/lib/db';
import { type PeopleNames, personName } from '@/lib/sops/names';
import { ConfirmDialog } from '../ConfirmDialog';
import { ActivityFeed } from '../goals/ActivityFeed';
import { dangerButtonClass, labelClass, textareaClass } from '../goalsUi';
import { FieldRow } from '../guestUi';
import { LinkTextarea } from '../LinkTextarea';
import { SopMarkdown } from '../SopMarkdown';
import { useSheetSwipe } from '../useSheetSwipe';
import { CardLinkField } from './CardLinkField';
import { AssigneePicker, DuePicker, InlineTitle, StatusPicker, WaitingPicker } from './CardMeta';
import { ChecklistField } from './ChecklistField';
import { FilesField } from './FilesField';
import { useCardAutosave } from './useCardAutosave';

export interface CardDrawerProps {
  card: BoardCardRow;
  columns: BoardColumnRow[];
  fields: BoardFieldRow[];
  people: PeopleNames;
  /** Everyone who can own a card, by email. */
  owners: { email: string; name: string }[];
  /** Linked cards by id, for the link fields' chips. */
  links?: Map<string, LinkSummary>;
  /** A card was picked in a link field; the board keeps its summary for the row. */
  onLinkPicked?: (summary: LinkSummary) => void;
  /** Who is looking: a checklist tap shows their name until the server's stamp arrives. */
  viewerEmail?: string;
  busy?: boolean;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  onDelete: () => Promise<void>;
  /**
   * The board the card is on, named above the title with a link to it — for
   * a drawer opened anywhere but that board's own page.
   */
  board?: { name: string; slug: string };
  onClose: () => void;
}

export function CardDrawer({
  card,
  columns,
  fields,
  people,
  owners,
  links,
  board,
  onLinkPicked,
  viewerEmail = '',
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
  const [assignees, setAssignees] = useState(card.assignee_emails);
  const [dueDate, setDueDate] = useState(card.due_date ?? '');
  const [repeat, setRepeat] = useState<RepeatRule | null>(() => repeatRuleOf(card));
  const [waitingOn, setWaitingOn] = useState(card.waiting_on ?? '');
  const [properties, setProperties] = useState<Record<string, BoardFieldValue | null>>(
    card.properties
  );
  const [preview, setPreview] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // The rows behind the card's files answers: names and sizes for the ids.
  const [attachments, setAttachments] = useState<AttachmentSummary[]>([]);
  // Linked cards' summaries: what the board sent, plus anything picked here.
  const [known, setKnown] = useState<Map<string, LinkSummary>>(() => new Map(links ?? []));
  const autosave = useCardAutosave(onSave);
  // The server ends a repeat when the card is finished (the next copy takes
  // the rule); the chip follows what the card says now.
  useEffect(() => {
    setRepeat(repeatRuleOf({ repeat_every: card.repeat_every, repeat_unit: card.repeat_unit }));
  }, [card.repeat_every, card.repeat_unit]);
  const saving = autosave.status === 'saving' || autosave.status === 'pending';
  const error = !title.trim() ? 'A card needs a title.' : autosave.error;
  /** Resolves true once the drawer has closed with every edit saved. */
  const close = async (): Promise<boolean> => {
    if (!title.trim() || closeInProgress.current) return false;
    closeInProgress.current = true;
    try {
      if (!(await autosave.flush())) return false;
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
      return true;
    } finally {
      closeInProgress.current = false;
    }
  };
  const closeAction = useRef(close);
  closeAction.current = close;

  const hasFiles = fields.some((field) => fileIdsOf(card.properties[field.key]).length > 0);
  useEffect(() => {
    if (!hasFiles) return;
    let cancelled = false;
    void fetch(`/api/admin/board-media?card=${encodeURIComponent(card.id)}`)
      .then(async (res) => {
        if (!res.ok) return;
        const body = (await res.json()) as { attachments?: AttachmentSummary[] };
        if (!cancelled && body.attachments) setAttachments(body.attachments);
      })
      .catch(() => {
        // The ids still list; the chips just read "File" until the next open.
      });
    return () => {
      cancelled = true;
    };
  }, [card.id, hasFiles]);

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

  // The column select and a finished checklist both move the card this way.
  const moveToColumn = (id: string) => {
    if (id === columnId) return;
    setColumnId(id);
    const destination = columns.find((column) => column.id === id);
    if (destination && isFinishedKind(destination.kind)) {
      setWaitingOn('');
      autosave.schedule({ columnId: id, waitingOn: null }, 0);
    } else {
      autosave.schedule({ columnId: id }, 0);
    }
  };

  const liveColumns = columns.filter((c) => !c.archived || c.id === card.column_id);
  const liveFields = fields.filter((f) => !f.archived || properties[f.key] != null);
  const finished = card.completed_at !== null;
  const today = todayEastern();

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
        {board && (
          <a
            href={boardHref(board.slug)}
            data-astro-prefetch
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              // Leave by closing, so an edit still waiting to save is saved first.
              event.preventDefault();
              void close().then((closed) => {
                if (closed) void navigate(boardHref(board.slug));
              });
            }}
            className="mb-1 inline-flex max-w-full items-center gap-1 font-mono text-[11px] uppercase tracking-wide text-white/45 hover:text-white"
          >
            <span className="truncate">{board.name}</span>
            <span aria-hidden="true">→</span>
          </a>
        )}
        <div className="mb-1 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <InlineTitle
              id={titleId}
              value={title}
              finished={finished}
              onChange={(next) => {
                setTitle(next);
                if (next.trim()) autosave.schedule({ title: next }, 600);
                else autosave.discard('title');
              }}
            />
          </div>
          <button
            ref={closeRef}
            type="button"
            className={`${formButtonClass} shrink-0`}
            onClick={() => void close()}
          >
            Close
          </button>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <StatusPicker columns={liveColumns} value={columnId} onChange={moveToColumn} />
          <AssigneePicker
            owners={owners}
            value={assignees}
            names={(email) => personName(email, people)}
            onChange={(next) => {
              setAssignees(next);
              autosave.schedule({ assigneeEmails: next }, 0);
            }}
          />
          <DuePicker
            value={dueDate}
            repeat={repeat}
            today={today}
            onDateChange={(next) => {
              setDueDate(next);
              autosave.schedule({ dueDate: next || null }, 0);
            }}
            onRepeatChange={(next, delay) => {
              setRepeat(next);
              autosave.schedule({ repeat: next }, delay);
            }}
          />
          <WaitingPicker
            value={waitingOn}
            disabled={finished}
            onChange={(next) => {
              setWaitingOn(next);
              autosave.schedule({ waitingOn: next || null }, 600);
            }}
          />
        </div>

        <div className="space-y-4">
          {liveFields.length > 0 && (
            <div className="space-y-3 border-t border-white/10 pt-4">
              {liveFields.map((field) => {
                const change = (next: BoardFieldValue | null) => {
                  const updated = { ...properties };
                  // Explicit null clears a saved answer; omitted keys are preserved by PATCH.
                  updated[field.key] = next;
                  setProperties(updated);
                  autosave.schedule({ properties: updated });
                };
                if (field.kind === 'checklist') {
                  const inputId = `card-${card.id}-${field.key}`;
                  // Where a finished list sends the card: a live column of
                  // this board, or nowhere.
                  const target = field.checklist_done_column
                    ? columns.find(
                        (column) => column.key === field.checklist_done_column && !column.archived
                      )
                    : undefined;
                  return (
                    <div key={field.key}>
                      <span className={labelClass} id={`${inputId}-label`}>
                        {field.label}
                        {field.archived && <span className="ml-2 text-white/30">(retired)</span>}
                      </span>
                      {field.hint && (
                        <p className="-mt-1 mb-2 text-xs text-white/40">{field.hint}</p>
                      )}
                      <ChecklistField
                        id={inputId}
                        field={field}
                        value={properties[field.key]}
                        people={people}
                        viewerEmail={viewerEmail}
                        destination={target?.label}
                        disabled={field.archived}
                        // A tap is a choice and saves now; typing in the
                        // list waits for a pause, like the notes.
                        onChange={(next, immediate) => {
                          const updated = { ...properties, [field.key]: next };
                          setProperties(updated);
                          autosave.schedule({ properties: updated }, immediate ? 0 : 600);
                        }}
                        onComplete={target ? () => moveToColumn(target.id) : undefined}
                      />
                    </div>
                  );
                }
                if (field.kind === 'card_link') {
                  const inputId = `card-${card.id}-${field.key}`;
                  return (
                    <div key={field.key}>
                      {field.link_board_id ? (
                        <CardLinkField
                          id={inputId}
                          label={field.label}
                          hint={field.hint}
                          retired={field.archived}
                          fieldId={field.id}
                          value={linkIdsOf(properties[field.key])}
                          multiple={field.link_multiple}
                          known={known}
                          disabled={field.archived}
                          onPicked={(summary) => {
                            setKnown((prev) => new Map(prev).set(summary.id, summary));
                            onLinkPicked?.(summary);
                          }}
                          // A link is a choice, not typing: save it now.
                          onChange={(next) => {
                            const updated = { ...properties, [field.key]: next };
                            setProperties(updated);
                            autosave.schedule({ properties: updated }, 0);
                          }}
                        />
                      ) : (
                        <>
                          <span className={labelClass}>
                            {field.label}
                            {field.archived && (
                              <span className="ml-2 text-white/30">(retired)</span>
                            )}
                          </span>
                          <p className="text-xs text-white/35">
                            The board this field linked to has been deleted.
                          </p>
                        </>
                      )}
                    </div>
                  );
                }
                if (field.kind === 'files') {
                  const inputId = `card-${card.id}-${field.key}`;
                  return (
                    <div key={field.key}>
                      <label className={labelClass} htmlFor={inputId}>
                        {field.label}
                        {field.archived && <span className="ml-2 text-white/30">(retired)</span>}
                      </label>
                      {field.hint && (
                        <p className="-mt-1 mb-2 text-xs text-white/40">{field.hint}</p>
                      )}
                      <FilesField
                        id={inputId}
                        label={field.label}
                        value={fileIdsOf(properties[field.key])}
                        known={attachments}
                        action="/api/admin/board-media"
                        params={{ boardId: card.board_id, field: field.key }}
                        href={adminAttachmentHref}
                        disabled={field.archived}
                        // A file lands on the card as soon as it is uploaded; a
                        // debounce would only leave a staged row waiting.
                        onChange={(next) => change(next)}
                      />
                    </div>
                  );
                }
                return (
                  <FieldRow
                    key={field.key}
                    idPrefix={`card-${card.id}`}
                    field={field}
                    value={properties[field.key]}
                    onChange={change}
                  />
                );
              })}
            </div>
          )}

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className={`${labelClass} mb-0`}>Notes</span>
              <button
                type="button"
                className={formButtonClass}
                onClick={() => setPreview((on) => !on)}
              >
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
              <LinkTextarea
                className={textareaClass}
                maxLength={BOARD_LIMITS.notes}
                placeholder="Markdown is fine here. Type [name](/ to link a page or SOP."
                value={notes}
                onChange={(next) => {
                  setNotes(next);
                  autosave.schedule({ notesMd: next }, 600);
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
                <button
                  type="button"
                  className={formButtonClass}
                  onClick={() => void autosave.flush()}
                >
                  Retry
                </button>
              )}
            </div>
          </div>

          <div className="border-t border-white/10 pt-4">
            <ActivityFeed
              cardId={card.id}
              boardId={card.board_id}
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

function boardHref(slug: string): string {
  return `/admin/boards/${slug}`;
}

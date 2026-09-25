// Reclassify shift notes in bulk (/admin/shift-notes, admins only), so a
// change to the classifier — a new signal, a sharper definition — can be run
// over the notes already in the log, not only new ones. The panel has its
// own filters, separate from the log's, because the question differs: not
// "what am I reading" but "what should be read again". By default it skips
// resolved notes and picks everything else; the admin narrows by status,
// by where the last read stands, by author, and by shift dates, sees how
// many notes match, and runs it. The notes then show "Reading…" and settle
// as the queue works through them (lib/classify/dispatch runs a few at a
// time).
//
// A note an admin has set a status on keeps it — only its tags refresh.
// Any other note moves to To do or Resolved by what the new read finds
// (lib/shift-notes/triage).

import { useMemo, useState } from 'react';
import type { ClassificationView } from '@/lib/classify/view';
import type { ShiftNoteRow, ShiftNoteStatus } from '@/lib/db';
import { SHIFT_NOTE_STATUSES, statusLabel } from '@/lib/shift-notes/access';
import { type PeopleNames, personName } from '@/lib/sops/names';
import { buttonClass, inputClass, primaryButtonClass, selectClass } from './ShiftNoteComposer';
import { SparkleIcon } from './Signals';

/** Where a note's last read stands, for picking which to read again. */
type ReadFilter = 'any' | 'never' | 'failed' | 'classified';

const READ_FILTERS: ReadonlyArray<{ value: ReadFilter; label: string }> = [
  { value: 'any', label: 'Any' },
  { value: 'never', label: 'Never classified' },
  { value: 'failed', label: 'Couldn’t classify' },
  { value: 'classified', label: 'Already classified' },
];

function matchesRead(view: ClassificationView | undefined, filter: ReadFilter): boolean {
  switch (filter) {
    case 'never':
      return !view;
    case 'failed':
      return view?.state === 'failed';
    case 'classified':
      return view?.state === 'done';
    default:
      return true;
  }
}

const labelClass = 'block font-mono text-[10px] uppercase tracking-wide text-white/50';

/** Notes per run that may also ask for suggestions (the route holds to the same). */
export const MAX_BULK_SUGGEST = 100;

export function BulkClassify({
  notes,
  classifications,
  names,
  authors,
  onRun,
  canSuggest = false,
}: {
  notes: readonly ShiftNoteRow[];
  classifications: Record<string, ClassificationView>;
  names: PeopleNames;
  /** Author emails to offer, in display order. */
  authors: readonly string[];
  /** Queue the notes (and, with `suggest`, have the agent look at each once read). */
  onRun: (
    ids: string[],
    options: { suggest: boolean }
  ) => Promise<{ queued: number; missing: number }>;
  /** Suggestions are on (Settings), so offer to ask for them too. */
  canSuggest?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [statuses, setStatuses] = useState<ReadonlySet<ShiftNoteStatus>>(
    () => new Set<ShiftNoteStatus>(['open', 'todo'])
  );
  const [read, setRead] = useState<ReadFilter>('any');
  const [person, setPerson] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [suggest, setSuggest] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const matching = useMemo(
    () =>
      notes.filter(
        (note) =>
          statuses.has(note.status) &&
          matchesRead(classifications[note.id], read) &&
          (person === 'all' || note.author_email === person) &&
          (!from || note.note_date >= from) &&
          (!to || note.note_date <= to)
      ),
    [notes, classifications, statuses, read, person, from, to]
  );

  const toggleStatus = (status: ShiftNoteStatus) =>
    setStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });

  const suggesting = canSuggest && suggest;
  const overSuggestLimit = suggesting && matching.length > MAX_BULK_SUGGEST;

  const run = async () => {
    const count = matching.length;
    if (count === 0 || overSuggestLimit) return;
    const noun = count === 1 ? 'note' : 'notes';
    if (
      !window.confirm(
        `Classify ${count} ${noun}? Notes nobody has set a status on will move to To do or Resolved by what is found.${
          suggesting
            ? ` The agent will then read each one and suggest tasks or SOP edits for you to review — ${count} agent ${count === 1 ? 'run' : 'runs'}, two at a time.`
            : ''
        }`
      )
    ) {
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const { queued, missing } = await onRun(
        matching.map((n) => n.id),
        { suggest: suggesting }
      );
      setResult({
        tone: 'ok',
        text: `Queued ${queued} ${queued === 1 ? 'note' : 'notes'}. They show “Reading…” until their turn comes — a few at a time.${
          suggesting
            ? ' Suggestions appear under each note, and in Suggestions, as the agent finishes.'
            : ''
        }${missing > 0 ? ` ${missing} had been deleted.` : ''}`,
      });
    } catch (e) {
      setResult({
        tone: 'error',
        text: e instanceof Error ? e.message : 'Could not queue the notes',
      });
    } finally {
      setRunning(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className={`${buttonClass} flex items-center gap-1.5`}
        aria-expanded={false}
        onClick={() => setOpen(true)}
      >
        <SparkleIcon />
        Bulk classify
      </button>
    );
  }

  return (
    <section
      aria-label="Bulk classify"
      className="w-full space-y-4 rounded border border-white/10 bg-white/5 p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-wide text-white/70">
          <SparkleIcon />
          Bulk classify
        </h2>
        <button
          type="button"
          className={buttonClass}
          aria-expanded
          onClick={() => {
            setOpen(false);
            setResult(null);
          }}
        >
          Close
        </button>
      </div>
      <p className="text-xs text-white/50">
        Read notes already in the log again, e.g. after the classifier changes. A note an admin has
        set a status on keeps it; only its tags refresh.
      </p>

      <div className="flex flex-wrap gap-x-6 gap-y-4">
        <fieldset className="space-y-1.5">
          <legend className={labelClass}>Status</legend>
          <div className="flex flex-wrap gap-3 pt-1">
            {SHIFT_NOTE_STATUSES.map((status) => (
              <label key={status} className="flex items-center gap-1.5 text-sm text-white/80">
                <input
                  type="checkbox"
                  checked={statuses.has(status)}
                  onChange={() => toggleStatus(status)}
                />
                {statusLabel(status)}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="space-y-1.5">
          <span className={labelClass}>Last read</span>
          <select
            className={`${selectClass} block`}
            value={read}
            onChange={(e) => setRead(e.target.value as ReadFilter)}
          >
            {READ_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5">
          <span className={labelClass}>Person</span>
          <select
            className={`${selectClass} block`}
            value={person}
            onChange={(e) => setPerson(e.target.value)}
          >
            <option value="all">Anyone</option>
            {authors.map((email) => (
              <option key={email} value={email}>
                {personName(email, names)}
              </option>
            ))}
          </select>
        </label>

        <div className="space-y-1.5">
          <span className={labelClass}>Shift dates</span>
          <div className="flex items-center gap-2">
            <input
              type="date"
              className={inputClass}
              aria-label="From shift date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <span className="text-xs text-white/40">to</span>
            <input
              type="date"
              className={inputClass}
              aria-label="To shift date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>
      </div>

      {canSuggest && (
        <label className="flex items-start gap-2 text-sm text-white/80">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={suggest}
            onChange={(e) => setSuggest(e.target.checked)}
          />
          <span>
            Also suggest tasks and SOP edits
            <span className="block text-xs text-white/40">
              After reading each note, the agent proposes tasks, comments on existing tasks, or SOP
              edits for you to review. One agent run per note, up to {MAX_BULK_SUGGEST} at a time.
            </span>
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
        <button
          type="button"
          className={primaryButtonClass}
          disabled={running || matching.length === 0 || overSuggestLimit}
          onClick={() => void run()}
        >
          {running
            ? 'Queuing…'
            : `Classify ${matching.length} ${matching.length === 1 ? 'note' : 'notes'}${
                suggesting ? ' and suggest' : ''
              }`}
        </button>
        <span className="font-mono text-[10px] text-white/40">
          {matching.length} of {notes.length} notes match.
          {overSuggestLimit &&
            ` Narrow the filters to ${MAX_BULK_SUGGEST} or fewer to suggest tasks too.`}
        </span>
      </div>
      {result && (
        <p
          className={`text-sm ${
            result.tone === 'ok' ? 'text-[var(--pyre-sage)]' : 'text-[var(--pyre-red)]'
          }`}
        >
          {result.text}
        </p>
      )}
    </section>
  );
}

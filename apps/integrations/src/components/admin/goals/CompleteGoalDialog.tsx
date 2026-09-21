// Marking a goal met.
//
// The dialog exists to make one thing hard to do by accident and easy to do
// honestly: it shows the two numbers a founder should look at first — how
// many KPIs are actually met, and how much work is still open — and then
// asks what was true. Neither number blocks the button. A goal whose KPIs
// are met with three tasks still open is a fine goal to close; a goal at
// 12/12 tasks with a KPI short is a fine one to leave open. The system's job
// is to put both in front of the person and keep what they wrote.

import { useEffect, useId, useRef, useState } from 'react';
import type { CompletionPreview } from '@/lib/goals/access';
import { GOAL_LIMITS } from '@/lib/goals/types';
import { buttonClass, primaryButtonClass, textareaClass } from '../goalsUi';

export function CompleteGoalDialog({
  goalTitle,
  preview,
  busy = false,
  onConfirm,
  onCancel,
}: {
  goalTitle: string;
  preview: CompletionPreview;
  busy?: boolean;
  onConfirm: (note: string) => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const noteId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const kpiLine =
    preview.kpisTotal === 0
      ? 'No KPIs on this goal — it is met when you say it is.'
      : `${preview.kpisMet} of ${preview.kpisTotal} KPIs met.`;
  const taskLine =
    preview.openCards === 0
      ? 'Nothing is still open.'
      : `${preview.openCards} task${preview.openCards === 1 ? '' : 's'} still open.`;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-0 sm:items-center sm:p-4">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Cancel"
        onClick={onCancel}
        className="absolute inset-0 h-full w-full cursor-default bg-black/70"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-md rounded-t-lg border border-white/15 bg-[var(--pyre-black)] p-5 shadow-xl sm:rounded-lg"
      >
        <h2 id={titleId} className="font-primary-semibold text-lg text-[var(--pyre-creme)]">
          Mark “{goalTitle}” completed?
        </h2>

        <ul className="mt-3 space-y-1 text-sm text-white/70">
          <li>{kpiLine}</li>
          <li>{taskLine}</li>
        </ul>

        <label
          className="mt-4 block font-mono text-xs uppercase tracking-wide text-white/50"
          htmlFor={noteId}
        >
          What was true when you called it?
        </label>
        <textarea
          id={noteId}
          className={`${textareaClass} mt-1.5 min-h-[80px]`}
          maxLength={GOAL_LIMITS.completionNote}
          placeholder="Staff ran four consecutive weeks with no founder on site. The shift-lead number is short, and that's fine."
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <p className="mt-1 text-xs text-white/35">
          Optional, and worth a sentence — the KPI numbers never tell the whole story.
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={onCancel}
          >
            Not yet
          </button>
          <button
            type="button"
            className={primaryButtonClass}
            disabled={busy}
            onClick={() => onConfirm(note.trim())}
          >
            Mark completed
          </button>
        </div>
      </div>
    </div>
  );
}

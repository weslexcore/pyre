// The plus button in the admin header: opens the shift-note composer in a
// modal so a note — text, photos, video — can be written from any page
// without leaving it. Shown only to people who may open /admin/shift-notes
// (AdminLayout decides). Modal mechanics follow GlobalSearch (backdrop
// button, Escape, full screen on mobile).
//
// The composer stays mounted while the modal is closed, so a stray tap on
// the backdrop hides a half-written note instead of throwing it away, and
// uploads already running keep going. Once a note lands the modal closes
// and a short confirmation links to it in the log.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { usePresence } from '@/lib/client/usePresence';
import { SHIFT_NOTES_HREF } from './adminTools';
import { type CreatedShiftNote, ShiftNoteComposer } from './ShiftNoteComposer';

const TOAST_MS = 6000;

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M9 3v12M3 9h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function QuickShiftNote() {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<{ noteId: string; message: string } | null>(null);
  const titleId = useId();
  // The overlay only toggles display (the composer stays mounted to keep a
  // draft), so entry runs off @starting-style as the overlay turns visible,
  // and `closing` holds it on screen, inert, while it fades back out.
  const { mounted: shown, closing } = usePresence(open);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    textareaRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [done]);

  const onCreated = useCallback((created: CreatedShiftNote, message: string) => {
    setOpen(false);
    setDone({ noteId: created.note.id, message });
  }, []);

  return (
    <>
      <button
        type="button"
        aria-label="Add a shift note"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Add a shift note"
        onClick={() => {
          setDone(null);
          setOpen(true);
        }}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-white/20 text-[var(--pyre-creme)] transition-colors hover:border-white/40 hover:bg-white/10"
      >
        <PlusIcon />
      </button>

      <div
        inert={closing}
        className={`fixed inset-0 z-50 items-start justify-center sm:p-4 sm:pt-[12vh] ${
          shown ? 'flex' : 'hidden'
        }`}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label="Close"
          onClick={close}
          className={`absolute inset-0 h-full w-full cursor-default bg-black/70 transition-opacity duration-150 ease-out starting:opacity-0 motion-reduce:transition-none ${closing ? 'opacity-0' : ''}`}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={`relative flex h-full w-full max-w-2xl flex-col bg-[var(--pyre-black)] shadow-xl transition duration-150 ease-out starting:translate-y-2 starting:scale-[0.98] starting:opacity-0 motion-reduce:transition-none sm:h-auto sm:max-h-[85vh] sm:rounded-lg sm:border sm:border-white/15 ${closing ? 'translate-y-2 scale-[0.98] opacity-0' : ''}`}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-5 py-4 sm:px-6">
            <h2 id={titleId} className="text-lg font-semibold text-[var(--pyre-creme)]">
              Add a shift note
            </h2>
            <button
              type="button"
              onClick={close}
              className="shrink-0 rounded border border-white/20 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-white/60 transition-colors hover:border-white/40 hover:text-white"
            >
              <span className="sm:hidden">Close</span>
              <span className="hidden sm:inline">esc</span>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
            <ShiftNoteComposer heading={null} textareaRef={textareaRef} onCreated={onCreated} />
            <a
              href={SHIFT_NOTES_HREF}
              data-astro-prefetch="tap"
              onClick={close}
              className="mt-4 inline-block font-mono text-[10px] uppercase tracking-wide text-white/40 hover:text-white"
            >
              All shift notes
            </a>
          </div>
        </div>
      </div>

      {done && (
        <div
          role="status"
          className="fixed inset-x-4 bottom-4 z-50 flex items-center gap-3 rounded border border-[var(--pyre-sage)]/40 bg-[var(--pyre-black)] px-3 py-2 text-sm text-[var(--pyre-sage)] shadow-xl transition duration-150 ease-out starting:translate-y-2 starting:opacity-0 motion-reduce:transition-none sm:inset-x-auto sm:right-4 sm:max-w-sm"
        >
          <span className="min-w-0 flex-1">{done.message}</span>
          <a
            href={`${SHIFT_NOTES_HREF}#note-${done.noteId}`}
            data-astro-prefetch="tap"
            onClick={() => setDone(null)}
            className="shrink-0 font-mono text-[10px] uppercase tracking-wide underline hover:text-white"
          >
            View
          </a>
        </div>
      )}
    </>
  );
}

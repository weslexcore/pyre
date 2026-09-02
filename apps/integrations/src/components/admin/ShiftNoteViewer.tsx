// Lightbox for shift note media: clicking a photo or video thumbnail on
// /admin/shift-notes opens it here, full size, instead of leaving the page for
// a raw file tab. Previous / Next (and the arrow keys) step through the same
// note's photos and videos in the order they sit under the note, so a run of
// shots from one shift reads as one set. PDFs still open in a new tab — they
// need the browser's own viewer. Modal mechanics follow the SopPeekModal /
// MeasurementInfo pattern (backdrop button, Escape, focus on Close).
import { useEffect, useRef } from 'react';
import type { ShiftNoteAttachmentRow } from '@/lib/db';

const navButtonClass =
  'rounded border border-white/20 bg-black/60 px-3 py-2 font-mono text-xs uppercase tracking-wide text-white/70 transition-colors hover:border-white/50 hover:text-white disabled:cursor-default disabled:opacity-30';

/** The URL the media API serves an attachment's bytes from. */
export function attachmentSrc(attachment: ShiftNoteAttachmentRow): string {
  return `/api/admin/shift-note-media?id=${encodeURIComponent(attachment.id)}`;
}

export function ShiftNoteViewer({
  items,
  index,
  onNavigate,
  onClose,
}: {
  /** The note's photos and videos, in display order. */
  items: ShiftNoteAttachmentRow[];
  /** Which of `items` is on screen. */
  index: number;
  onNavigate: (index: number) => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const current = items[index];
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      } else if (event.key === 'ArrowLeft' && hasPrev) {
        event.preventDefault();
        onNavigate(index - 1);
      } else if (event.key === 'ArrowRight' && hasNext) {
        event.preventDefault();
        onNavigate(index + 1);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, onNavigate, index, hasPrev, hasNext]);

  if (!current) return null;
  const src = attachmentSrc(current);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/85"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={current.file_name}
        className="relative flex max-h-full w-full max-w-5xl flex-col gap-3"
      >
        <div className="flex items-center gap-3 font-mono text-xs text-white/60">
          <span className="min-w-0 flex-1 truncate" title={current.file_name}>
            {current.file_name}
          </span>
          {items.length > 1 && (
            <span className="shrink-0 tabular-nums text-white/40">
              {index + 1} / {items.length}
            </span>
          )}
          <a
            href={`${src}&download=1`}
            className="shrink-0 uppercase tracking-wide underline hover:text-white"
          >
            download
          </a>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="shrink-0 rounded border border-white/20 px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-white/60 transition-colors hover:border-white/40 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center">
          {current.kind === 'video' ? (
            // biome-ignore lint/a11y/useMediaCaption: shift footage has no caption track
            <video
              key={current.id}
              src={src}
              controls
              autoPlay
              preload="metadata"
              className="max-h-[80vh] max-w-full rounded bg-black object-contain"
            />
          ) : (
            <img
              key={current.id}
              src={src}
              alt={current.file_name}
              className="max-h-[80vh] max-w-full rounded object-contain"
            />
          )}
        </div>

        {items.length > 1 && (
          <div className="flex items-center justify-between">
            <button
              type="button"
              className={navButtonClass}
              disabled={!hasPrev}
              onClick={() => onNavigate(index - 1)}
            >
              ← Previous
            </button>
            <button
              type="button"
              className={navButtonClass}
              disabled={!hasNext}
              onClick={() => onNavigate(index + 1)}
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

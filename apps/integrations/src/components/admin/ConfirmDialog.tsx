// Styled replacement for window.confirm in the checklist flows (finish with
// unchecked items, discard with checks). Follows the MeasurementInfo modal
// pattern: hand-rolled overlay, backdrop button for click-outside, Escape to
// cancel, bottom sheet on mobile. Focus starts on Cancel so a stray double-tap
// can't confirm a destructive action.
import { useEffect, useId, useRef } from 'react';

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  /** Styles the confirm button red for actions that erase work. */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

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
        className="relative w-full max-w-md whitespace-normal rounded-t-lg border border-white/15 bg-[var(--pyre-black)] p-5 shadow-xl sm:rounded-lg"
      >
        <h2 id={titleId} className="font-primary-semibold text-lg text-[var(--pyre-creme)]">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-white/70">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded border border-white/20 px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-white/60 transition-colors hover:border-white/40 hover:text-white disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={
              danger
                ? 'rounded border border-[var(--pyre-red)]/50 bg-[var(--pyre-red)]/10 px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-[var(--pyre-red)] transition-colors hover:border-[var(--pyre-red)] disabled:opacity-40'
                : 'rounded border border-[var(--pyre-gold)]/50 bg-[var(--pyre-gold)]/10 px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-[var(--pyre-gold)] transition-colors hover:border-[var(--pyre-gold)] disabled:opacity-40'
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// Styled replacement for window.confirm: a title, an optional explanation,
// and Cancel / confirm. Focus starts on Cancel so a stray double-tap can't
// confirm a destructive action. Render it directly, or call confirmAction()
// for a one-line `if (!(await confirmAction(...))) return;`.
import { useId, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Modal, modalPanelClass } from './Modal';

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel: string;
  /** Styles the confirm button red for actions that erase work. */
  danger?: boolean;
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmOptions & {
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Modal
      labelledBy={titleId}
      onClose={onCancel}
      backdropLabel="Cancel"
      initialFocus={cancelRef}
      panelClassName={`max-w-md whitespace-normal p-5 ${modalPanelClass}`}
    >
      <h2 id={titleId} className="font-primary-semibold text-lg text-[var(--pyre-creme)]">
        {title}
      </h2>
      {body && <p className="mt-2 text-sm leading-relaxed text-white/70">{body}</p>}
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
    </Modal>
  );
}

/**
 * Ask, and resolve true on confirm or false on cancel. Mounts its own
 * dialog, so a call site needs no state or JSX — the drop-in for
 * window.confirm.
 */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const settle = (answer: boolean) => {
      root.unmount();
      host.remove();
      resolve(answer);
    };
    root.render(
      <ConfirmDialog {...options} onConfirm={() => settle(true)} onCancel={() => settle(false)} />
    );
  });
}

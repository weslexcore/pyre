// The admin islands' dialog shell: a dimmed backdrop that closes on click,
// Escape to close, and a panel that is a bottom sheet on a phone and a
// centred card from `sm` up.
//
// The backdrop is a real button rather than a div with a click handler:
// click-outside-to-dismiss then costs no a11y compromise, and it stays out of
// the tab order because Close and Escape are the keyboard paths. Each dialog
// focuses its own first control (usually Close or Cancel) via `initialFocus`.

import { type ReactNode, type RefObject, useEffect } from 'react';

export function Modal({
  labelledBy,
  onClose,
  backdropLabel = 'Close',
  panelClassName = '',
  initialFocus,
  closeOnEscape,
  children,
}: {
  /** The id of the dialog's heading. */
  labelledBy: string;
  onClose: () => void;
  backdropLabel?: string;
  /** Size and surface of the panel; it is always `relative w-full`. */
  panelClassName?: string;
  initialFocus?: RefObject<HTMLElement | null>;
  /** Whether Escape should close right now (e.g. not while a nested confirm is up). */
  closeOnEscape?: () => boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    initialFocus?.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (closeOnEscape?.() ?? true)) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, initialFocus, closeOnEscape]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-0 sm:items-center sm:p-4">
      <button
        type="button"
        tabIndex={-1}
        aria-label={backdropLabel}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/70"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`relative w-full ${panelClassName}`}
      >
        {children}
      </div>
    </div>
  );
}

/** The standard panel surface: a card with a sheet's top corners on a phone. */
export const modalPanelClass =
  'rounded-t-lg border border-white/15 bg-[var(--pyre-black)] shadow-xl sm:rounded-lg';

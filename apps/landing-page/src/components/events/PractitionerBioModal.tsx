// Practitioner bio modal — opened from a practitioner byline on the events
// page. Layers above the event detail modal (which pauses its own keyboard
// handling while this is open) so the guest can be read without losing the
// event they came from.

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { practitionerCopy, practitionerInitials } from '@/lib/practitioners';
import type { Practitioner } from '@/lib/types';

interface PractitionerBioModalProps {
  practitioner: Practitioner | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function PractitionerBioModal({
  practitioner,
  isOpen,
  onClose,
}: PractitionerBioModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    previousFocusRef.current = document.activeElement as HTMLElement | null;
    // Restore the previous value rather than clearing it — when this opens on
    // top of the event modal that modal's own lock must survive our close.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    requestAnimationFrame(() => {
      closeBtnRef.current?.focus();
    });

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      // Focus trap
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocusRef.current?.focus) {
        previousFocusRef.current.focus();
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen || !practitioner) return null;

  const bio = (practitioner.bio ?? []).filter((paragraph) => paragraph.trim().length > 0);

  const modal = (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="practitioner-bio-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 transition-opacity duration-300"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="relative z-10 flex flex-col w-full max-w-md max-h-[85vh] overflow-hidden rounded-lg border border-[var(--pyre-creme)]/10 bg-[var(--pyre-black)] shadow-2xl"
      >
        {/* Close button */}
        <button
          ref={closeBtnRef}
          type="button"
          onClick={onClose}
          aria-label={practitionerCopy.closeLabel}
          className="absolute top-3 right-3 z-30 rounded-full border border-[var(--pyre-gold)]/70 bg-black/40 backdrop-blur-sm p-1.5 text-[var(--pyre-creme)] hover:bg-black/60 hover:border-[var(--pyre-gold)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pyre-gold)]/50"
        >
          <svg
            className="size-5"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="2"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="overflow-y-auto px-6 py-8">
          {/* Header — headshot (or monogram) over name + role */}
          <div className="flex flex-col items-center text-center">
            {practitioner.photo ? (
              <img
                src={practitioner.photo.src}
                alt={practitioner.photo.alt ?? practitioner.name}
                className="w-24 h-24 rounded-full object-cover border border-[var(--pyre-gold)]/40"
                loading="lazy"
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex w-24 h-24 items-center justify-center rounded-full border border-[var(--pyre-gold)]/40 bg-[var(--pyre-creme)]/10 font-mono-bold text-2xl uppercase tracking-wide text-[var(--pyre-muted-gold)]"
              >
                {practitionerInitials(practitioner.name)}
              </span>
            )}

            <h2
              id="practitioner-bio-title"
              className="mt-4 font-mono-bold text-xl uppercase tracking-wide text-[var(--pyre-creme)]"
            >
              {practitioner.name}
            </h2>

            {practitioner.role && (
              <p className="mt-1 font-mono text-xs uppercase tracking-widest text-[var(--pyre-muted-gold)]">
                {practitioner.role}
              </p>
            )}
          </div>

          {/* Bio */}
          {bio.length > 0 && (
            <div className="mt-6 space-y-4">
              {bio.map((paragraph) => (
                <p
                  key={paragraph.slice(0, 48)}
                  className="font-sans text-base leading-relaxed text-[var(--pyre-creme)]/80"
                >
                  {paragraph}
                </p>
              ))}
            </div>
          )}

          {/* Links */}
          {practitioner.links && practitioner.links.length > 0 && (
            <div className="mt-6 flex flex-wrap justify-center gap-3 border-t border-[var(--pyre-creme)]/10 pt-5">
              {practitioner.links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={link.ariaLabel ?? `${practitioner.name} — ${link.label}`}
                  className="inline-flex items-center rounded-full border border-[var(--pyre-creme)]/20 px-4 py-1.5 font-mono text-xs uppercase tracking-wide text-[var(--pyre-creme)]/80 transition-colors hover:border-[var(--pyre-gold)]/60 hover:text-[var(--pyre-creme)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pyre-gold)]/50"
                >
                  {link.label}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

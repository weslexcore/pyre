// Practitioner byline — the "Hosted by <avatar> <name>" credit shown on special
// events. When the roster has a bio for the practitioner the avatar + name
// become a button that opens the bio modal; otherwise it renders as plain text.

import { hasBio, practitionerCopy, practitionerInitials } from '@/lib/practitioners';
import type { Practitioner } from '@/lib/types';

// `row` is the compact schedule-row treatment; `modal` is the larger block
// inside the event detail modal.
type BylineVariant = 'row' | 'modal';

const AVATAR_CLASSES: Record<BylineVariant, string> = {
  row: 'w-6 h-6 text-[10px]',
  modal: 'w-11 h-11 text-sm',
};

export function PractitionerAvatar({
  practitioner,
  variant = 'row',
}: {
  practitioner: Practitioner;
  variant?: BylineVariant;
}) {
  const base = `${AVATAR_CLASSES[variant]} shrink-0 rounded-full object-cover border border-[var(--pyre-gold)]/40`;

  if (practitioner.photo) {
    return (
      <img
        src={practitioner.photo.src}
        alt={practitioner.photo.alt ?? practitioner.name}
        className={base}
        loading="lazy"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`${base} flex items-center justify-center bg-[var(--pyre-creme)]/10 font-mono-bold uppercase tracking-wide text-[var(--pyre-muted-gold)]`}
    >
      {practitionerInitials(practitioner.name)}
    </span>
  );
}

// One practitioner: avatar + name, wrapped in a button when a bio exists.
function PractitionerCredit({
  practitioner,
  variant,
  onOpenBio,
}: {
  practitioner: Practitioner;
  variant: BylineVariant;
  onOpenBio?: (practitioner: Practitioner) => void;
}) {
  const isClickable = !!onOpenBio && hasBio(practitioner);
  const nameClasses =
    variant === 'row'
      ? 'font-mono text-xs uppercase tracking-wide'
      : 'font-mono-bold text-sm uppercase tracking-wide';

  const content = (
    <>
      <PractitionerAvatar practitioner={practitioner} variant={variant} />
      <span className="flex flex-col items-start min-w-0">
        <span className={`${nameClasses} truncate`}>{practitioner.name}</span>
        {variant === 'modal' && practitioner.role && (
          <span className="font-sans text-xs text-[var(--pyre-creme)]/50">{practitioner.role}</span>
        )}
        {variant === 'modal' && isClickable && (
          <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--pyre-muted-gold)]">
            {practitionerCopy.viewBioLabel}
          </span>
        )}
      </span>
    </>
  );

  if (!isClickable) {
    return (
      <span className="inline-flex items-center gap-2 text-[var(--pyre-creme)]/70 min-w-0">
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        // Schedule rows are themselves clickable — don't open the event modal too.
        e.stopPropagation();
        onOpenBio?.(practitioner);
      }}
      aria-label={`${practitionerCopy.viewBioLabel} — ${practitioner.name}`}
      className="inline-flex items-center gap-2 min-w-0 rounded-full text-left text-[var(--pyre-creme)]/80 transition-colors hover:text-[var(--pyre-creme)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pyre-gold)]/50"
    >
      {content}
    </button>
  );
}

export default function PractitionerByline({
  practitioners,
  variant = 'row',
  showLabel = variant === 'modal',
  className = '',
  onOpenBio,
}: {
  practitioners: Practitioner[];
  variant?: BylineVariant;
  showLabel?: boolean;
  className?: string;
  onOpenBio?: (practitioner: Practitioner) => void;
}) {
  if (practitioners.length === 0) return null;

  return (
    <div className={`flex items-center gap-x-3 gap-y-1 flex-wrap min-w-0 ${className}`}>
      {showLabel && (
        <span className="font-mono text-[11px] uppercase tracking-widest text-[var(--pyre-creme)]/40">
          {practitionerCopy.bylineLabel}
        </span>
      )}
      {practitioners.map((practitioner) => (
        <PractitionerCredit
          key={practitioner.name}
          practitioner={practitioner}
          variant={variant}
          onOpenBio={onOpenBio}
        />
      ))}
    </div>
  );
}

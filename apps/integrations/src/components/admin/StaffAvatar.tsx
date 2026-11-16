// A staff member as a round badge: their photo, or their first initial on
// their colour. Pass the email every page already names people by; the
// photo, colour and name come from the staff directory AdminLayout writes
// into the page (lib/client/staffDirectory). Someone not on the roster
// still gets a badge, coloured from their email.

import { useState } from 'react';
import { useStaffEntry } from '@/lib/client/staffDirectory';
import { avatarColorFor, initialOf } from '@/lib/staff/avatar';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZES: Record<AvatarSize, string> = {
  xs: 'h-4 w-4 text-[8px]',
  sm: 'h-5 w-5 text-[10px]',
  md: 'h-7 w-7 text-xs',
  lg: 'h-10 w-10 text-base',
  xl: 'h-20 w-20 text-3xl',
};

export function StaffAvatar({
  email,
  name,
  size = 'sm',
  ring = false,
  className = '',
}: {
  email: string | null | undefined;
  /** Shown when the directory has no name for them (or no email is known). */
  name?: string | null;
  size?: AvatarSize;
  /** A dark ring, for badges that overlap (AvatarStack). */
  ring?: boolean;
  className?: string;
}) {
  const entry = useStaffEntry(email);
  const label = entry?.name || name?.trim() || email?.split('@')[0] || '';
  const src = entry?.src ?? null;
  // A photo that fails to load (deleted, signed out) falls back to the initial.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showPhoto = src !== null && failedSrc !== src;

  return (
    <span
      aria-hidden="true"
      title={label || undefined}
      style={
        showPhoto
          ? undefined
          : { backgroundColor: entry?.color ?? avatarColorFor(null, email ?? label) }
      }
      className={`inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold leading-none text-white ${
        ring ? 'ring-2 ring-[var(--pyre-black)]' : ''
      } ${SIZES[size]} ${className}`}
    >
      {showPhoto ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailedSrc(src)}
          className="h-full w-full object-cover"
        />
      ) : (
        initialOf(label)
      )}
    </span>
  );
}

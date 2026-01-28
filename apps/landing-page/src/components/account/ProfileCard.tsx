// ProfileCard component
// Displays user profile information (view only)
// Users are directed to Momence to update their profile

import { useEffect, useState } from 'react';
import type { MomenceUserProfile } from '@/lib/momence-oauth-types';
import { accountConfig } from '@/lib/account-config';
import { getLocalProfileOverrides } from '@/hooks/useUpdateProfile';

interface ProfileCardProps {
  user: MomenceUserProfile;
}

export function ProfileCard({ user }: ProfileCardProps) {
  const [phone, setPhone] = useState(user.phone || '');

  // Merge with localStorage overrides on mount
  useEffect(() => {
    const overrides = getLocalProfileOverrides();
    if (overrides?.phone !== undefined) {
      setPhone(overrides.phone);
    }
  }, []);

  const fullName = `${user.firstName} ${user.lastName}`.trim();
  const hasPhone = phone.trim() !== '';

  return (
    <div className="bg-[var(--pyre-black)] text-[var(--pyre-creme)] rounded-lg p-6 card-cta-animated">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-mono-bold text-lg uppercase tracking-wide">
          {accountConfig.profile.title}
        </h2>
        <a
          href={accountConfig.profile.getManageUrl(user.id)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-mono uppercase text-[var(--pyre-red)] hover:text-[var(--pyre-red)]/80 transition-colors"
        >
          {accountConfig.profile.editButton}
        </a>
      </div>

      <div className="flex items-start gap-4">
        {/* Avatar */}
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt={fullName}
            className="w-16 h-16 rounded-full object-cover"
          />
        ) : (
          <div className="w-16 h-16 rounded-full bg-[var(--pyre-blue)] flex items-center justify-center">
            <span className="font-mono-bold text-xl text-[var(--pyre-creme)]">
              {user.firstName.charAt(0)}
              {user.lastName.charAt(0)}
            </span>
          </div>
        )}

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="font-primary-semibold text-xl truncate">{fullName}</p>

          <div className="mt-2 space-y-1 text-sm opacity-80">
            <p>
              <span className="font-mono-bold uppercase text-xs">
                {accountConfig.profile.emailLabel}:
              </span>{' '}
              {user.email}
            </p>
            {hasPhone && (
              <p>
                <span className="font-mono-bold uppercase text-xs">
                  {accountConfig.profile.phoneLabel}:
                </span>{' '}
                {phone}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

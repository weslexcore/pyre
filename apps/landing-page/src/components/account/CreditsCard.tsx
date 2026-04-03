// CreditsCard component
// Displays user's available credits and inline session packs for purchase

import { useMemberCredits } from '@/hooks/useMemberCredits';
import { accountConfig } from '@/lib/account-config';
import sessions from '@/lib/sessions';
import type { SessionItem } from '@/lib/sessions';

export function CreditsCard() {
  const { credits, hasCredits, loading, error } = useMemberCredits();

  const isAuthError = error === 'not_authenticated';

  // Loading state
  if (loading) {
    return (
      <div className="bg-[var(--pyre-blue)] text-[var(--pyre-creme)] rounded-lg p-6">
        <div className="h-6 w-32 bg-[var(--pyre-creme)]/20 rounded animate-pulse mb-4" />
        <div className="h-10 w-20 bg-[var(--pyre-creme)]/20 rounded animate-pulse mb-4" />
        <div className="h-4 w-48 bg-[var(--pyre-creme)]/20 rounded animate-pulse" />
      </div>
    );
  }

  // Error state (non-auth errors)
  if (error && !isAuthError) {
    return (
      <div className="bg-[var(--pyre-blue)] text-[var(--pyre-creme)] rounded-lg p-6">
        <h2 className="font-mono-bold text-lg uppercase tracking-wide mb-4">
          {accountConfig.credits.title}
        </h2>
        <p className="text-sm opacity-80 mb-4">Failed to load credits.</p>
        <SessionPacks />
      </div>
    );
  }

  // Has credits
  if (hasCredits && credits) {
    const expiryDate = credits.expiresAt
      ? new Date(credits.expiresAt).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        })
      : null;

    return (
      <div className="bg-[var(--pyre-blue)] text-[var(--pyre-creme)] rounded-lg p-6">
        <h2 className="font-mono-bold text-lg uppercase tracking-wide mb-4">
          {accountConfig.credits.title}
        </h2>

        <p className="font-mono-bold text-4xl mb-4">
          {credits.unlimited ? accountConfig.membership.unlimitedLabel : credits.available}
        </p>

        {(credits.source || expiryDate) && (
          <div className="flex items-center gap-4 text-sm opacity-70 mb-4">
            {credits.source && (
              <span>
                {accountConfig.credits.sourceLabel}: {credits.source}
              </span>
            )}
            {expiryDate && (
              <span>
                {accountConfig.credits.expiresLabel}: {expiryDate}
              </span>
            )}
          </div>
        )}

        {!credits.unlimited && <SessionPacks />}
      </div>
    );
  }

  // No credits
  return (
    <div className="bg-[var(--pyre-blue)] text-[var(--pyre-creme)] rounded-lg p-6">
      <h2 className="font-mono-bold text-lg uppercase tracking-wide mb-4">
        {accountConfig.credits.title}
      </h2>
      <p className="text-sm opacity-80 mb-2">{accountConfig.credits.emptyState}</p>
      <p className="text-sm opacity-60 mb-6">{accountConfig.credits.emptyStateSubtitle}</p>
      <SessionPacks />
    </div>
  );
}

function SessionPacks() {
  return (
    <div className="mt-2">
      <h3 className="font-mono-bold text-sm uppercase tracking-wide opacity-70 mb-3">
        {accountConfig.credits.packsHeading}
      </h3>
      <div className="flex flex-col gap-2">
        {sessions.items.map((item) => (
          <SessionPackRow key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function SessionPackRow({ item }: { item: SessionItem }) {
  const isHighlighted = item.highlighted;

  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-md px-3 py-2.5 ${
        isHighlighted
          ? 'bg-[var(--pyre-gold)]/15 ring-1 ring-[var(--pyre-gold)]/40'
          : 'bg-[var(--pyre-creme)]/8'
      }`}
    >
      <div className="min-w-0 flex-1">
        <span
          className={`font-mono-bold text-sm ${isHighlighted ? 'text-[var(--pyre-gold)]' : ''}`}
        >
          {item.name}
        </span>
        <span className="ml-2 text-xs opacity-60">{item.description}</span>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="font-mono-bold text-sm">${item.price}</span>
        {item.href && (
          <a
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center justify-center rounded px-3 py-1 font-mono-bold text-xs uppercase tracking-wide transition-opacity hover:opacity-90 ${
              isHighlighted
                ? 'bg-[var(--pyre-gold)] text-[var(--pyre-blue)]'
                : 'bg-[var(--pyre-creme)] text-[var(--pyre-blue)]'
            }`}
          >
            Buy
          </a>
        )}
      </div>
    </div>
  );
}

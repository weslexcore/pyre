// CreditsCard component
// Displays user's available credits and purchase CTA

import { useMemberCredits } from '@/hooks/useMemberCredits';
import { accountConfig } from '@/lib/account-config';

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
        <PurchaseCta />
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
          {credits.unlimited
            ? accountConfig.membership.unlimitedLabel
            : credits.available}
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

        <PurchaseCta />
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
      <PurchaseCta prominent />
    </div>
  );
}

function PurchaseCta({ prominent = false }: { prominent?: boolean }) {
  if (prominent) {
    return (
      <a
        href={accountConfig.credits.purchaseHref}
        className="inline-flex items-center justify-center px-5 py-2.5 rounded-md font-mono-bold text-sm uppercase tracking-wide bg-[var(--pyre-creme)] text-[var(--pyre-blue)] hover:opacity-90 transition-opacity"
      >
        {accountConfig.credits.purchaseCta} &rarr;
      </a>
    );
  }

  return (
    <a
      href={accountConfig.credits.purchaseHref}
      className="inline-block font-mono-bold text-sm uppercase tracking-wide underline hover:no-underline"
    >
      {accountConfig.credits.purchaseCta} &rarr;
    </a>
  );
}

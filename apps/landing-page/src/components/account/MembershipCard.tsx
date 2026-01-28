// MembershipCard component
// Displays user's membership status, credits, and purchase options

import { useMemberCredits } from '@/hooks/useMemberCredits';
import { useMemberMemberships } from '@/hooks/useMemberMemberships';
import { accountConfig } from '@/lib/account-config';
import membershipConfig from '@/lib/membership';
import type { MemberCredits, MemberMembership } from '@/lib/momence-member-types';

function findMatchingTier(membershipName: string) {
  const normalized = membershipName.trim().toLowerCase();
  return membershipConfig.tiers.find(
    (tier) =>
      tier.name.toLowerCase() === normalized ||
      tier.id === normalized.replace(/\s+/g, '-'),
  );
}

export function MembershipCard() {
  const { activeMembership, loading: membershipLoading, error: membershipError } = useMemberMemberships();
  const { credits, hasCredits, loading: creditsLoading, error: creditsError } = useMemberCredits();

  const loading = membershipLoading || creditsLoading;

  // Only show error state if membership API fails (ignore auth errors)
  // Credits errors are handled gracefully - we just don't show credits
  const hasMembershipError = membershipError && membershipError !== 'not_authenticated';

  // If credits API fails, we can still show the membership card without credits
  const effectiveCredits = creditsError ? null : credits;
  const effectiveHasCredits = !creditsError && hasCredits;

  // Loading state
  if (loading) {
    return (
      <div className="bg-[var(--pyre-black)] text-[var(--pyre-creme)] rounded-lg p-6">
        <div className="h-6 w-32 bg-[var(--pyre-black)]/20 rounded animate-pulse mb-4" />
        <div className="h-4 w-48 bg-[var(--pyre-black)]/20 rounded animate-pulse" />
      </div>
    );
  }

  // If membership API errors, fall through to no-membership display
  // so users always see purchase options instead of a dead-end error
  if (hasMembershipError) {
    return <NoMembershipDisplay credits={effectiveCredits} hasCredits={effectiveHasCredits} />;
  }

  // No active membership
  if (!activeMembership) {
    return <NoMembershipDisplay credits={effectiveCredits} hasCredits={effectiveHasCredits} />;
  }

  return <ActiveMembershipDisplay membership={activeMembership} credits={effectiveCredits} />;
}

interface CreditsDisplayProps {
  credits: MemberCredits;
  compact?: boolean;
}

function CreditsDisplay({ credits, compact = false }: CreditsDisplayProps) {
  const expiryDate = credits.expiresAt
    ? new Date(credits.expiresAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })
    : null;

  if (compact) {
    return (
      <div className="bg-[var(--pyre-black)]/10 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="font-mono-bold text-sm uppercase tracking-wide opacity-80">
            {accountConfig.membership.creditsLabel}
          </p>
          <p className="font-mono-bold text-2xl">
            {credits.unlimited ? accountConfig.membership.unlimitedLabel : credits.available}
          </p>
        </div>
        {(credits.source || expiryDate) && (
          <div className="flex items-center gap-4 text-xs opacity-70">
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
      </div>
    );
  }

  return (
    <div className="mb-4">
      <p className="text-sm opacity-80">{accountConfig.membership.creditsLabel}</p>
      <p className="font-mono-bold text-2xl">
        {credits.unlimited ? accountConfig.membership.unlimitedLabel : credits.available}
      </p>
      {(credits.source || expiryDate) && (
        <div className="flex items-center gap-4 text-xs opacity-70 mt-1">
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
    </div>
  );
}

interface NoMembershipDisplayProps {
  credits: MemberCredits | null;
  hasCredits: boolean;
}

function NoMembershipDisplay({ credits, hasCredits }: NoMembershipDisplayProps) {
  const tiers = membershipConfig.tiers;

  return (
    <div className="bg-[var(--pyre-black)] text-[var(--pyre-creme)] rounded-lg p-6 border border-[var(--pyre-creme)]/30">
      <h2 className="font-mono-bold text-lg uppercase tracking-wide mb-4">
        {accountConfig.membership.title}
      </h2>

      {hasCredits && credits ? (
        // Has credits but no membership - show credits + upgrade prompt
        <>
          <CreditsDisplay credits={credits} compact />
          <a
            href="/#membership"
            className="inline-block mt-4 font-mono-bold text-sm uppercase tracking-wide underline hover:no-underline"
          >
            {accountConfig.membership.upgradePrompt} &rarr;
          </a>
        </>
      ) : (
        // No credits and no membership - show membership options
        <>
          <p className="text-sm opacity-80 mb-2">{accountConfig.membership.emptyState}</p>
          <p className="text-sm opacity-60 mb-6">{accountConfig.membership.emptyStateSubtitle}</p>

          {/* Membership tier cards */}
          <div className="flex flex-col gap-4 mb-4">
            {tiers.map((tier) => (
              <a
                key={tier.id}
                href={tier.cta.href}
                aria-label={tier.cta.ariaLabel}
                className="block p-4 rounded-lg border border-[var(--pyre-creme)]/30 hover:border-[var(--pyre-creme)] hover:bg-[var(--pyre-creme)]/10 transition-colors"
              >
                <div className="flex items-baseline justify-between mb-3">
                  <span className="font-mono-bold text-sm uppercase tracking-wide">
                    {tier.name}
                  </span>
                  <span className="text-lg font-primary-semibold">
                    ${tier.price}
                    <span className="text-sm opacity-70">{tier.period}</span>
                  </span>
                </div>
                <ul className="space-y-1.5 text-sm">
                  {tier.features.map((feature, i) => (
                    <li
                      key={i}
                      className={`flex items-start gap-2 ${feature.highlighted ? 'text-[var(--pyre-muted-gold)]' : 'opacity-80'}`}
                    >
                      <svg
                        className="w-4 h-4 mt-0.5 flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      {feature.text}
                    </li>
                  ))}
                </ul>
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

interface ActiveMembershipDisplayProps {
  membership: MemberMembership;
  credits: MemberCredits | null;
}

function ActiveMembershipDisplay({ membership, credits }: ActiveMembershipDisplayProps) {
  const renewalDate = membership.renewalDate
    ? new Date(membership.renewalDate).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  // Use credits from useMemberCredits hook (includes all sources) if available,
  // otherwise fall back to membership.credits
  const displayCredits = credits || (membership.credits ? {
    available: membership.credits.remaining,
    unlimited: membership.credits.unlimited,
  } : null);

  // Resolve benefits from tier config, falling back to API-provided benefits
  const matchedTier = findMatchingTier(membership.name);
  const benefits = matchedTier
    ? matchedTier.features.map((f) => ({ text: f.text, highlighted: f.highlighted }))
    : membership.benefits?.map((b) => ({ text: b, highlighted: false })) ?? [];

  return (
    <div className="bg-[var(--pyre-gold)] text-[var(--pyre-black)] rounded-lg p-6">
      <div className="flex items-start justify-between mb-4">
        <h2 className="font-mono-bold text-lg uppercase tracking-wide">
          {accountConfig.membership.title}
        </h2>
        <span className="px-2 py-1 text-xs font-mono-bold uppercase rounded bg-[var(--pyre-black)]/20">
          {membership.status}
        </span>
      </div>

      {/* Membership name */}
      <p className="font-primary-semibold text-xl mb-4">{membership.name}</p>

      {/* Credits/Sessions - using aggregated credits from hook */}
      {displayCredits && (
        <div className="mb-4">
          <p className="text-sm opacity-80">{accountConfig.membership.sessionsLabel}</p>
          <p className="font-mono-bold text-2xl">
            {displayCredits.unlimited
              ? accountConfig.membership.unlimitedLabel
              : displayCredits.available}
          </p>
        </div>
      )}

      {/* Renewal date */}
      {renewalDate && (
        <div className="pt-4 border-t border-[var(--pyre-black)]/20">
          <p className="text-sm">
            <span className="opacity-80">{accountConfig.membership.renewalLabel}</span>{' '}
            <span className="font-mono-bold">{renewalDate}</span>
          </p>
        </div>
      )}

      {/* Benefits from tier config */}
      {benefits.length > 0 && (
        <div className="mt-4 pt-4 border-t border-[var(--pyre-black)]/20">
          <p className="font-mono-bold text-sm uppercase tracking-wide mb-3 opacity-80">
            {accountConfig.membership.benefitsLabel}
          </p>
          <ul className="space-y-2 text-sm">
            {benefits.map((benefit, i) => (
              <li
                key={i}
                className={`flex items-start gap-2 ${benefit.highlighted ? 'text-[var(--pyre-muted-gold)]' : 'opacity-80'}`}
              >
                <svg
                  className="w-4 h-4 mt-0.5 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                {benefit.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

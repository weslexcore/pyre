// ReferralCard component
// The member's personal referral code, shareable link, and stats.

import { useState } from 'react';
import { useReferral } from '@/hooks/useReferral';
import { accountConfig } from '@/lib/account-config';

const copy = accountConfig.referral;

export function ReferralCard() {
  const { referral, loading, error } = useReferral();
  const [copied, setCopied] = useState(false);

  if (loading) {
    return (
      <div className="bg-[var(--pyre-red)] text-[var(--pyre-creme)] rounded-lg p-6">
        <div className="h-6 w-48 bg-[var(--pyre-creme)]/20 rounded animate-pulse mb-4" />
        <div className="h-10 w-32 bg-[var(--pyre-creme)]/20 rounded animate-pulse mb-4" />
        <div className="h-4 w-full bg-[var(--pyre-creme)]/20 rounded animate-pulse" />
      </div>
    );
  }

  if (error || !referral) {
    return (
      <div className="bg-[var(--pyre-red)] text-[var(--pyre-creme)] rounded-lg p-6">
        <h2 className="font-mono-bold text-lg uppercase tracking-wide mb-4">{copy.title}</h2>
        <p className="text-sm opacity-80">{copy.errorState}</p>
      </div>
    );
  }

  if (!referral.enabled) {
    return (
      <div className="bg-[var(--pyre-red)] text-[var(--pyre-creme)] rounded-lg p-6">
        <h2 className="font-mono-bold text-lg uppercase tracking-wide mb-4">{copy.title}</h2>
        <p className="text-sm opacity-80">{copy.disabledState}</p>
      </div>
    );
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(referral.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the visible URL below is selectable.
    }
  };

  const share = async () => {
    const text = copy.shareText(referral.url, referral.discountPercent);
    if (navigator.share) {
      try {
        await navigator.share({ text, url: referral.url });
        return;
      } catch {
        // Cancelled or unsupported — fall through to copy.
      }
    }
    await copyLink();
  };

  return (
    <div className="bg-[var(--pyre-red)] text-[var(--pyre-creme)] rounded-lg p-6">
      <h2 className="font-mono-bold text-lg uppercase tracking-wide mb-2">{copy.title}</h2>
      <p className="text-sm opacity-80 mb-4">{copy.subtitle}</p>

      {referral.stats.rewardsActive > 0 && (
        <p className="inline-block rounded-full bg-[var(--pyre-creme)]/15 px-3 py-1 font-mono-bold text-xs uppercase tracking-wide mb-4">
          {copy.rewardActiveBadge}
        </p>
      )}

      <div className="mb-4">
        <p className="font-mono-bold text-xs uppercase tracking-wide opacity-70 mb-1">
          {copy.codeLabel}
        </p>
        <p className="font-mono-bold text-3xl tracking-wide">{referral.code}</p>
      </div>

      <div className="mb-5">
        <p className="font-mono-bold text-xs uppercase tracking-wide opacity-70 mb-1.5">
          {copy.linkLabel}
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <span className="flex-1 min-w-0 truncate rounded-md bg-[var(--pyre-creme)]/10 px-3 py-2 text-sm select-all">
            {referral.url}
          </span>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={copyLink}
              className="inline-flex items-center justify-center rounded px-3 py-2 font-mono-bold text-xs uppercase tracking-wide bg-[var(--pyre-creme)] text-[var(--pyre-red)] hover:opacity-90 transition-opacity"
            >
              {copied ? copy.copiedLabel : copy.copyButton}
            </button>
            <button
              type="button"
              onClick={share}
              className="inline-flex items-center justify-center rounded px-3 py-2 font-mono-bold text-xs uppercase tracking-wide border border-[var(--pyre-creme)]/50 hover:bg-[var(--pyre-creme)]/10 transition-colors"
            >
              {copy.shareButton}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <ReferralStat label={copy.stats.clicksLabel} value={referral.stats.clicks} />
        <ReferralStat label={copy.stats.redemptionsLabel} value={referral.stats.redemptions} />
        <ReferralStat label={copy.stats.conversionsLabel} value={referral.stats.conversions} />
      </div>
    </div>
  );
}

function ReferralStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-[var(--pyre-creme)]/10 px-2 py-3">
      <p className="font-mono-bold text-2xl">{value}</p>
      <p className="text-xs opacity-70 mt-0.5">{label}</p>
    </div>
  );
}

// Presentation bits shared by the campaign islands.

import { describeLink } from '@/lib/campaigns/describe';
import type { LinkRow, UtmCampaign } from '@/lib/campaigns/types';
import { campaignTypeLabel } from '@/lib/campaigns/types';

/** "2026-09-01" -> "Sep 1, 2026". Dates are calendar days, not instants. */
export function formatYmd(ymd: string): string {
  if (!ymd) return '';
  const ms = Date.parse(`${ymd}T12:00:00Z`);
  if (Number.isNaN(ms)) return ymd;
  return new Date(ms).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** The campaign's run, as the cards and header show it. */
export function dateRangeLabel(campaign: Pick<UtmCampaign, 'startsAt' | 'endsAt'>): string {
  const start = formatYmd(campaign.startsAt);
  const end = formatYmd(campaign.endsAt);
  if (start && end) return `${start} to ${end}`;
  if (start) return `From ${start}`;
  if (end) return `Until ${end}`;
  return '';
}

/** What a generated link reads as: its placement, with the partner or the
 * custom values spelled out where the placement alone would not tell two
 * links apart. */
export function linkTitle(
  link: Pick<LinkRow, 'placementKey' | 'variant' | 'source' | 'medium' | 'content'>
): string {
  return describeLink(link);
}

const TYPE_STYLES: Record<string, string> = {
  event: 'border-[var(--pyre-gold)]/50 text-[var(--pyre-gold)]',
  sale: 'border-[var(--pyre-red)]/60 text-[var(--pyre-red)]',
  newsletter: 'border-[var(--pyre-blue)] text-white/70',
  launch: 'border-[var(--pyre-sky)]/60 text-[var(--pyre-sky)]',
  evergreen: 'border-[var(--pyre-sage)]/50 text-[var(--pyre-sage)]',
  other: 'border-white/20 text-white/50',
};

const badgeBase =
  'inline-block rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide';

export function TypeBadge({ type }: { type: string }) {
  return (
    <span className={`${badgeBase} bg-transparent ${TYPE_STYLES[type] ?? TYPE_STYLES.other}`}>
      {campaignTypeLabel(type)}
    </span>
  );
}

export function ArchivedBadge() {
  return <span className={`${badgeBase} border-white/15 text-white/35`}>Archived</span>;
}

/** utm_* value as a small mono chip. */
export function UtmChip({ name, value }: { name: string; value: string }) {
  if (!value) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[11px]">
      <span className="text-white/35">{name}=</span>
      <span className="text-[var(--pyre-creme)]">{value}</span>
    </span>
  );
}

export const smallLabelClass =
  'block mb-1 font-mono text-[10px] uppercase tracking-wide text-white/40';

/** A 401/403 from an API mid-session: the cookie expired. */
export function isSessionExpired(error: string | null): boolean {
  return !!error && /HTTP 40[13]/.test(error);
}

export function SessionExpired({ returnTo }: { returnTo: string }) {
  return (
    <div className="max-w-md mx-auto text-center py-16 px-4">
      <h2 className="font-primary-semibold text-2xl mb-4 text-[var(--pyre-creme)]">
        Session expired
      </h2>
      <p className="text-white/60 mb-6">Log in again to continue.</p>
      <a
        href={`/api/auth/login?returnUrl=${encodeURIComponent(returnTo)}`}
        className="inline-block px-6 py-3 rounded-md font-mono-bold text-sm uppercase tracking-wide bg-[var(--pyre-red)] text-[var(--pyre-creme)] hover:opacity-90 transition-opacity"
      >
        Log In
      </a>
    </div>
  );
}

// How one campaign is doing: PostHog traffic and conversions for its slug
// (from the shared, cached performance report) and live short-link clicks
// per placement (from Redis, via the links already loaded on the page).

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LinkRow } from '@/lib/campaigns/types';
import { cardClass, SectionTitle } from '../incidentUi';
import { linkTitle } from './campaignUi';

interface CampaignRow {
  slug: string;
  shortlinkClicks: number;
  pageviews: number;
  visitors: number;
  introOfferSignups: number;
  mailingListSignups: number;
  bookings: number;
  introPurchases: number;
  creditPacks: number;
  memberships: number;
}

interface PerformanceResponse {
  generatedAt: string;
  days: number;
  cached: boolean;
  stale: boolean;
  campaigns: CampaignRow[];
  posthog: { configured: boolean; missingEvents: string[]; error: string | null };
}

const DAY_OPTIONS = [7, 30, 90] as const;

export function CampaignStats({ slug, links }: { slug: string; links: LinkRow[] }) {
  const [data, setData] = useState<PerformanceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<number>(30);

  const fetchReport = useCallback(
    async (currentDays: number, fresh = false) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/admin/campaign-performance?days=${currentDays}&campaign=${encodeURIComponent(slug)}${fresh ? '&fresh=1' : ''}`
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setError(body?.error ?? `Failed to fetch report (${res.status})`);
          return;
        }
        setData((await res.json()) as PerformanceResponse);
      } catch {
        setError('Network error');
      } finally {
        setLoading(false);
      }
    },
    [slug]
  );

  useEffect(() => {
    void fetchReport(days);
  }, [days, fetchReport]);

  const row = data?.campaigns[0];
  const maxClicks = useMemo(() => Math.max(1, ...links.map((l) => l.clicks)), [links]);
  const sorted = useMemo(() => [...links].sort((a, b) => b.clicks - a.clicks), [links]);

  const posthogIssue = data
    ? !data.posthog.configured
      ? 'PostHog querying is not configured. Showing link clicks only.'
      : data.posthog.error
        ? data.stale
          ? `PostHog query failed. Showing the last successful report from ${new Date(data.generatedAt).toLocaleString()}.`
          : `PostHog query failed: ${data.posthog.error}`
        : null
    : null;

  const stat = (label: string, value: number | undefined) => (
    <div className="rounded border border-white/10 bg-white/5 px-3 py-2">
      <div className="font-mono text-[10px] uppercase tracking-wide text-white/40">{label}</div>
      <div className="font-mono-bold text-lg text-[var(--pyre-creme)] tabular-nums">
        {value ?? '–'}
      </div>
    </div>
  );

  return (
    <section className={cardClass}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle note="Visits, signups, bookings and purchases are first-touch attributed by utm_campaign in PostHog. Clicks are live from the short links.">
          Performance
        </SectionTitle>
        <div className="flex items-center gap-2">
          {DAY_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setDays(option)}
              className={`px-2.5 py-1 rounded text-xs font-mono-bold transition-colors ${
                days === option
                  ? 'bg-white/15 text-[var(--pyre-creme)]'
                  : 'text-white/40 hover:text-white/70'
              }`}
            >
              {option}d
            </button>
          ))}
          <button
            type="button"
            onClick={() => void fetchReport(days, true)}
            disabled={loading}
            className="px-3 py-1.5 rounded text-xs font-mono-bold uppercase tracking-wide border border-white/20 text-white/60 hover:text-white hover:border-white/40 transition-colors disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {posthogIssue && <p className="mb-3 text-xs text-[var(--pyre-gold)]">{posthogIssue}</p>}
      {error && <p className="mb-3 text-xs text-[var(--pyre-red)]">{error}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {stat('Clicks', row?.shortlinkClicks ?? links.reduce((n, l) => n + l.clicks, 0))}
        {stat('Pageviews', row?.pageviews)}
        {stat('Visitors', row?.visitors)}
        {stat('Signups', row ? row.introOfferSignups + row.mailingListSignups : undefined)}
        {stat('Bookings', row?.bookings)}
        {stat('Intro purchases', row?.introPurchases)}
        {stat('Packs', row?.creditPacks)}
        {stat('Memberships', row?.memberships)}
      </div>

      {sorted.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {sorted.map((link) => (
            <li key={link.id} className="flex items-center gap-3 text-xs">
              <span className="w-44 shrink-0 truncate text-white/70">{linkTitle(link)}</span>
              <span className="h-2 flex-1 overflow-hidden rounded bg-white/5">
                <span
                  className="block h-full rounded bg-[var(--pyre-sage)]/70"
                  style={{ width: `${Math.round((link.clicks / maxClicks) * 100)}%` }}
                />
              </span>
              <span className="w-10 shrink-0 text-right font-mono text-white/60 tabular-nums">
                {link.clicks}
              </span>
            </li>
          ))}
        </ul>
      )}

      {data && (
        <p className="mt-3 font-mono text-[10px] text-white/35">
          Last {data.days} days. Generated {new Date(data.generatedAt).toLocaleString()}
          {data.stale ? ' (stale)' : data.cached ? ' (cached, refresh for live data)' : ''}
        </p>
      )}
    </section>
  );
}

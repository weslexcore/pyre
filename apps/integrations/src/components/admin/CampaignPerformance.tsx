// Campaign performance report, ported from the landing-page admin. Auth is
// handled server-side by AdminLayout; a 401/403 from the API mid-session
// renders a re-login prompt instead of a client-side gate.
import { Fragment, useCallback, useEffect, useState } from 'react';

interface CampaignRow {
  id: string;
  name: string;
  slug: string;
  createdAt: number;
  linkCount: number;
  shortlinks: Array<{ code: string; label: string; clicks: number }>;
  shortlinkClicks: number;
  pageviews: number;
  visitors: number;
  introOfferSignups: number;
  mailingListSignups: number;
  bookings: number;
}

interface PerformanceResponse {
  generatedAt: string;
  days: number;
  cached: boolean;
  campaigns: CampaignRow[];
  unattributed: Array<{ slug: string; pageviews: number; visitors: number }>;
  posthog: { configured: boolean; missingEvents: string[]; error: string | null };
}

const DAY_OPTIONS = [7, 30, 90] as const;

export function CampaignPerformance() {
  const [data, setData] = useState<PerformanceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<number>(30);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchReport = useCallback(async (currentDays: number, fresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/campaign-performance?days=${currentDays}${fresh ? '&fresh=1' : ''}`
      );
      if (res.status === 401 || res.status === 403) {
        setError('session_expired');
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Failed to fetch report (${res.status})`);
        return;
      }
      setData(await res.json());
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReport(days);
  }, [days, fetchReport]);

  if (error === 'session_expired') {
    return (
      <div className="max-w-md mx-auto text-center py-16 px-4">
        <h2 className="font-primary-semibold text-2xl mb-4 text-[var(--pyre-creme)]">
          Session expired
        </h2>
        <p className="text-white/60 mb-6">Log in again to continue.</p>
        <a
          href="/api/auth/login?returnUrl=%2Fadmin%2Fcampaigns"
          className="inline-block px-6 py-3 rounded-md font-mono-bold text-sm uppercase tracking-wide bg-[var(--pyre-red)] text-[var(--pyre-creme)] hover:opacity-90 transition-opacity"
        >
          Log In
        </a>
      </div>
    );
  }

  const posthogIssue = data
    ? !data.posthog.configured
      ? 'PostHog querying is not configured (set POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID) — showing link clicks only.'
      : data.posthog.error
        ? `PostHog query failed: ${data.posthog.error}`
        : data.posthog.missingEvents.length > 0
          ? `No ${data.posthog.missingEvents.join(', ')} events found in PostHog — those columns will read 0 until the events flow (check POSTHOG_API_KEY on the integrations deployment).`
          : null
    : null;

  return (
    <div>
      <div className="flex items-center justify-end gap-3">
        <div className="flex gap-1">
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
        </div>
        <button
          type="button"
          onClick={() => fetchReport(days, true)}
          disabled={loading}
          className="px-3 py-1.5 rounded text-xs font-mono-bold uppercase tracking-wide border border-white/20 text-white/60 hover:text-white hover:border-white/40 transition-colors disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {posthogIssue && (
        <div className="mt-4 p-3 bg-yellow-900/20 border border-yellow-900/40 rounded text-sm text-[var(--pyre-gold)]">
          {posthogIssue}
        </div>
      )}

      {error && (
        <div className="mt-4 p-3 bg-red-900/20 border border-red-900/40 rounded text-sm text-[var(--pyre-red)]">
          {error}
        </div>
      )}

      {data && data.campaigns.length === 0 && (
        <div className="text-center py-16 text-white/40">
          No campaigns yet. Create tracked links in UTM Assist to start measuring.
        </div>
      )}

      {data && data.campaigns.length > 0 && (
        <div className="mt-6 overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-white/40 text-xs uppercase tracking-wider">
                <th className="px-4 py-3">Campaign</th>
                <th className="px-4 py-3 text-right">Clicks</th>
                <th className="px-4 py-3 text-right">Pageviews</th>
                <th className="px-4 py-3 text-right">Visitors</th>
                <th className="px-4 py-3 text-right">Intro Offers</th>
                <th className="px-4 py-3 text-right">Mailing List</th>
                <th className="px-4 py-3 text-right">Bookings</th>
              </tr>
            </thead>
            <tbody className="text-[var(--pyre-creme)]">
              {data.campaigns.map((campaign) => {
                const expanded = expandedId === campaign.id;
                return (
                  <Fragment key={campaign.id}>
                    <tr
                      className="border-b border-white/5 hover:bg-white/5 cursor-pointer"
                      onClick={() => setExpandedId(expanded ? null : campaign.id)}
                    >
                      <td className="px-4 py-3">
                        <span className="text-white/30 mr-2">{expanded ? '▾' : '▸'}</span>
                        {campaign.name}
                        <span className="ml-2 font-mono text-xs text-white/30">
                          {campaign.slug}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {campaign.shortlinkClicks}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-white/60">
                        {campaign.pageviews}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-white/60">
                        {campaign.visitors}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {campaign.introOfferSignups}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {campaign.mailingListSignups}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-mono-bold">
                        {campaign.bookings}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-white/5 bg-white/[0.03]">
                        <td colSpan={7} className="px-6 py-3">
                          {campaign.shortlinks.length === 0 ? (
                            <p className="text-xs text-white/40">
                              No short links for this campaign ({campaign.linkCount} tracked link
                              {campaign.linkCount === 1 ? '' : 's'} without short codes).
                            </p>
                          ) : (
                            <ul className="space-y-1">
                              {campaign.shortlinks.map((link) => (
                                <li key={link.code} className="text-xs text-white/60">
                                  <span className="font-mono text-[var(--pyre-creme)]">
                                    /s/{link.code}
                                  </span>
                                  {link.label && <span> — {link.label}</span>}
                                  <span className="text-white/40">
                                    {' '}
                                    · {link.clicks} click{link.clicks === 1 ? '' : 's'}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && data.unattributed.length > 0 && (
        <div className="mt-6 rounded-lg border border-white/10 bg-white/5 px-4 py-3">
          <div className="text-xs uppercase tracking-wider text-white/40 mb-2">
            Seen in PostHog, not tracked in UTM Assist
          </div>
          <ul className="space-y-1">
            {data.unattributed.map((row) => (
              <li key={row.slug} className="text-xs text-white/60">
                <span className="font-mono">{row.slug}</span>
                <span className="text-white/40">
                  {' '}
                  · {row.pageviews} pageviews · {row.visitors} visitors
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data && (
        <div className="mt-4 text-xs text-white/40">
          Last {data.days} days · generated {new Date(data.generatedAt).toLocaleString()}
          {data.cached ? ' (cached, refresh for live data)' : ''}
        </div>
      )}
    </div>
  );
}

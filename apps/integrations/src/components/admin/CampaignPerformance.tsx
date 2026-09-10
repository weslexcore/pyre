// Cross-campaign performance report (/admin/campaigns/performance). Auth is
// handled server-side by AdminLayout; a 401/403 from the API mid-session
// renders a re-login prompt instead of a client-side gate.
//
// Two views of the same numbers: by campaign (what each initiative did) and
// by utm_source (how each channel did across every campaign — the newsletter,
// the automated lifecycle emails, Instagram). Conversions run from web signups
// through bookings to what people actually bought (intro offer, credit pack,
// membership), all attributed the same way. Campaign slugs PostHog has seen
// with no campaign record can be added as campaigns from here in one click,
// which is how the automated journeys become proper rows.

import { Fragment, useCallback, useEffect, useState } from 'react';
import { campaignErrorMessage } from '@/lib/campaigns/errors';
import { goalMetricLabel, measurementsOf } from '@/lib/campaigns/goals';
import { PLACEMENTS } from '@/lib/campaigns/placements';
import { slugToName } from '@/lib/campaigns/slug';
import type { CampaignGoal } from '@/lib/campaigns/types';
import { invalidateJson } from '@/lib/client/cachedJson';
import { buttonClass } from './incidentUi';

interface CampaignRow {
  id: string;
  name: string;
  slug: string;
  createdAt: number;
  /** Absent on a report served from an older cache entry. */
  goals?: CampaignGoal[];
  linkCount: number;
  shortlinks: Array<{ code: string; label: string; clicks: number; placementKey: string }>;
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

interface SourceRow {
  source: string;
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
  /** PostHog failed; numbers are from the last successful report (generatedAt). */
  stale: boolean;
  campaigns: CampaignRow[];
  sources?: SourceRow[];
  unattributed: Array<{ slug: string; pageviews: number; visitors: number }>;
  posthog: { configured: boolean; missingEvents: string[]; error: string | null };
}

const DAY_OPTIONS = [7, 30, 90] as const;
type View = 'campaign' | 'source';

// Sources the code sets that no placement tile produces.
const SOURCE_NOTES: Record<string, string> = {
  lifecycle: 'Automated emails',
  referral: 'Referral links',
  'referral-reward': 'Referral rewards',
  share: 'Event share button',
};

/** A friendly reading of a utm_source: the placement that produces it, or a
 * known code-set source. */
function sourceNote(source: string): string | null {
  return SOURCE_NOTES[source] ?? PLACEMENTS.find((p) => p.source === source)?.label ?? null;
}

/** A campaign's goals against this row's numbers. No pace here — the report
 * carries no dates, so a chip only says met or not yet. */
function GoalChips({ row }: { row: CampaignRow }) {
  if (!row.goals || row.goals.length === 0) return null;
  const measurements = measurementsOf(row);
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {row.goals.map((goal) => {
        const value = measurements[goal.metric];
        const hit = value >= goal.target;
        return (
          <span
            key={goal.metric}
            className={`rounded border px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${
              hit
                ? 'border-[var(--pyre-sage)]/60 text-[var(--pyre-sage)]'
                : 'border-white/15 text-white/45'
            }`}
          >
            {goalMetricLabel(goal.metric)} {value}/{goal.target}
          </span>
        );
      })}
    </div>
  );
}

const headCell = 'px-4 py-3';
const numCell = 'px-4 py-3 text-right tabular-nums';

export function CampaignPerformance() {
  const [data, setData] = useState<PerformanceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<number>(30);
  const [view, setView] = useState<View>('campaign');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

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

  // Register a slug PostHog has seen as a campaign so it gets a real row.
  // Evergreen, pointing home: the automated journeys this exists for never
  // change, and anything else can be edited once it has a page.
  const addAsCampaign = useCallback(
    async (slug: string) => {
      setAdding(slug);
      setAddError(null);
      try {
        const res = await fetch('/api/admin/campaigns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: slugToName(slug),
            type: 'evergreen',
            destination: { kind: 'home', value: '' },
          }),
        });
        // 409: someone added it a moment ago; the refetch below picks it up.
        if (!res.ok && res.status !== 409) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setAddError(campaignErrorMessage(body?.error, `Could not add (${res.status})`));
          return;
        }
        invalidateJson('/api/admin/campaigns');
        await fetchReport(days, true);
      } catch {
        setAddError('Network error');
      } finally {
        setAdding(null);
      }
    },
    [days, fetchReport]
  );

  if (error === 'session_expired') {
    return (
      <div className="max-w-md mx-auto text-center py-16 px-4">
        <h2 className="font-primary-semibold text-2xl mb-4 text-[var(--pyre-creme)]">
          Session expired
        </h2>
        <p className="text-white/60 mb-6">Log in again to continue.</p>
        <a
          href="/api/auth/login?returnUrl=%2Fadmin%2Fcampaigns%2Fperformance"
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
        ? data.stale
          ? `PostHog query failed — showing the last successful report from ${new Date(data.generatedAt).toLocaleString()}. Refresh to retry. (${data.posthog.error})`
          : `PostHog query failed: ${data.posthog.error}`
        : data.posthog.missingEvents.length > 0
          ? `No ${data.posthog.missingEvents.join(', ')} events found in PostHog — those columns will read 0 until the events flow (check POSTHOG_API_KEY on the integrations deployment).`
          : null
    : null;

  const sources = data?.sources ?? [];
  const toggleClass = (active: boolean) =>
    `px-2.5 py-1 rounded text-xs font-mono-bold transition-colors ${
      active ? 'bg-white/15 text-[var(--pyre-creme)]' : 'text-white/40 hover:text-white/70'
    }`;

  const numberHead = (
    <>
      <th className={`${headCell} text-right`}>Clicks</th>
      <th className={`${headCell} text-right`}>Pageviews</th>
      <th className={`${headCell} text-right`}>Visitors</th>
      <th className={`${headCell} text-right`}>Intro signups</th>
      <th className={`${headCell} text-right`}>Mailing list</th>
      <th className={`${headCell} text-right`}>Bookings</th>
      <th className={`${headCell} text-right`}>Intro purchases</th>
      <th className={`${headCell} text-right`}>Packs</th>
      <th className={`${headCell} text-right`}>Memberships</th>
    </>
  );

  const numberCells = (row: SourceRow | CampaignRow) => (
    <>
      <td className={numCell}>{row.shortlinkClicks}</td>
      <td className={`${numCell} text-white/60`}>{row.pageviews}</td>
      <td className={`${numCell} text-white/60`}>{row.visitors}</td>
      <td className={numCell}>{row.introOfferSignups}</td>
      <td className={numCell}>{row.mailingListSignups}</td>
      <td className={`${numCell} font-mono-bold`}>{row.bookings}</td>
      <td className={numCell}>{row.introPurchases}</td>
      <td className={`${numCell} font-mono-bold`}>{row.creditPacks}</td>
      <td className={`${numCell} font-mono-bold`}>{row.memberships}</td>
    </>
  );

  return (
    <div>
      <a href="/admin/campaigns" className={`${buttonClass} mb-4 inline-block`}>
        <span aria-hidden="true">&larr;</span> All campaigns
      </a>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1" role="tablist" aria-label="Group by">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'campaign'}
            onClick={() => setView('campaign')}
            className={toggleClass(view === 'campaign')}
          >
            By campaign
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'source'}
            onClick={() => setView('source')}
            className={toggleClass(view === 'source')}
          >
            By source
          </button>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {DAY_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setDays(option)}
                className={toggleClass(days === option)}
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

      {view === 'campaign' && data && data.campaigns.length === 0 && (
        <div className="text-center py-16 text-white/40">
          No campaigns yet.{' '}
          <a href="/admin/campaigns/new" className="underline">
            Create one
          </a>{' '}
          and generate its links to start measuring.
        </div>
      )}

      {view === 'campaign' && data && data.campaigns.length > 0 && (
        <div className="mt-6 overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-white/40 text-xs uppercase tracking-wider">
                <th className={headCell}>Campaign</th>
                {numberHead}
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
                      <td className={headCell}>
                        <span className="text-white/30 mr-2">{expanded ? '▾' : '▸'}</span>
                        <a
                          href={`/admin/campaigns/${campaign.id}`}
                          className="hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {campaign.name}
                        </a>
                        <span className="ml-2 font-mono text-xs text-white/30">
                          {campaign.slug}
                        </span>
                        <GoalChips row={campaign} />
                      </td>
                      {numberCells(campaign)}
                    </tr>
                    {expanded && (
                      <tr className="border-b border-white/5 bg-white/[0.03]">
                        <td colSpan={10} className="px-6 py-3">
                          {campaign.shortlinks.length === 0 ? (
                            <p className="text-xs text-white/40">
                              No short links for this campaign ({campaign.linkCount} link
                              {campaign.linkCount === 1 ? '' : 's'} without short codes).{' '}
                              <a href={`/admin/campaigns/${campaign.id}`} className="underline">
                                Open the campaign
                              </a>
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

      {view === 'source' && data && sources.length === 0 && (
        <div className="text-center py-16 text-white/40">No tagged traffic in this window yet.</div>
      )}

      {view === 'source' && data && sources.length > 0 && (
        <div className="mt-6 overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-white/40 text-xs uppercase tracking-wider">
                <th className={headCell}>Source</th>
                {numberHead}
              </tr>
            </thead>
            <tbody className="text-[var(--pyre-creme)]">
              {sources.map((row) => {
                const note = sourceNote(row.source);
                return (
                  <tr key={row.source} className="border-b border-white/5 hover:bg-white/5">
                    <td className={headCell}>
                      <span className="font-mono">{row.source}</span>
                      {note && <span className="ml-2 text-xs text-white/40">{note}</span>}
                    </td>
                    {numberCells(row)}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="px-4 py-2 text-xs text-white/40">
            utm_source across every campaign. Conversions are first-touch, so a person counts for
            the source that first brought them.
          </p>
        </div>
      )}

      {view === 'campaign' && data && data.unattributed.length > 0 && (
        <div className="mt-6 rounded-lg border border-white/10 bg-white/5 px-4 py-3">
          <div className="text-xs uppercase tracking-wider text-white/40 mb-2">
            Seen in PostHog, not a campaign here
          </div>
          <ul className="space-y-1.5">
            {data.unattributed.map((row) => (
              <li
                key={row.slug}
                className="flex flex-wrap items-center gap-2 text-xs text-white/60"
              >
                <span className="font-mono">{row.slug}</span>
                <span className="text-white/40">
                  · {row.pageviews} pageviews · {row.visitors} visitors
                </span>
                <button
                  type="button"
                  disabled={adding !== null}
                  onClick={() => void addAsCampaign(row.slug)}
                  className={`${buttonClass} !py-1 !text-[10px]`}
                >
                  {adding === row.slug ? 'Adding…' : 'Add as campaign'}
                </button>
              </li>
            ))}
          </ul>
          {addError && <p className="mt-2 text-xs text-[var(--pyre-red)]">{addError}</p>}
          <p className="mt-2 text-xs text-white/40">
            Automated emails tag their own links with their journey id, so they show up here until
            added. Added campaigns start as Evergreen pointing at the home page. Open one to change
            that.
          </p>
        </div>
      )}

      {data && (
        <div className="mt-4 text-xs text-white/40">
          Last {data.days} days · generated {new Date(data.generatedAt).toLocaleString()}
          {data.stale ? ' (stale)' : data.cached ? ' (cached, refresh for live data)' : ''}
        </div>
      )}
    </div>
  );
}

// How one campaign is doing: its goals read against the shared, cached
// performance report for its slug (PostHog traffic and conversions), plus
// live short-link clicks per placement (from Redis, via the links already
// loaded on the page).
//
// The window defaults to the shortest report window that still reaches back
// to the day the campaign started, so a goal is read against the whole run
// rather than an arbitrary 30 days.
//
// Momence totals describe the selected slots independently of campaign
// attribution, which may include other sessions and a different date window.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type CombinedEventBookings, campaignSessionIds } from '@/lib/campaigns/event-bookings';
import {
  elapsedFraction,
  GOAL_STATE_LABEL,
  type GoalProgress,
  type GoalState,
  goalMetricDef,
  goalProgress,
  goalWindow,
  measurementsOf,
} from '@/lib/campaigns/goals';
import {
  EMPTY_LINK_COUNTS,
  type LinkMetric,
  type LinkPerformance,
  reconcileLinks,
} from '@/lib/campaigns/link-performance';
import { campaignPhase, todayYmd } from '@/lib/campaigns/phase';
import type { LinkRow, UtmCampaign } from '@/lib/campaigns/types';
import { cardClass, SectionTitle } from '../incidentUi';
import { linkTitle } from './campaignUi';
import { eventLabel, useEvents } from './DestinationPicker';
import { LinkBar, LinkBreakdown } from './LinkBreakdown';

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
  linkPerformance: LinkPerformance[];
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

const STATE_TEXT: Record<GoalState, string> = {
  hit: 'text-[var(--pyre-sage)]',
  ahead: 'text-[var(--pyre-sage)]',
  'on-track': 'text-white/60',
  behind: 'text-[var(--pyre-gold)]',
  missed: 'text-[var(--pyre-red)]',
  running: 'text-white/50',
  untracked: 'text-[var(--pyre-gold)]',
};

export function CampaignStats({ campaign, links }: { campaign: UtmCampaign; links: LinkRow[] }) {
  const slug = campaign.slug;
  const today = useMemo(() => todayYmd(), []);
  const window = useMemo(() => goalWindow(campaign, today), [campaign, today]);

  const reportVersion = useRef(0);
  const [data, setData] = useState<PerformanceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Goals are read against the whole run; without any, 30 days is the habit.
  const [days, setDays] = useState<number>(campaign.goals.length > 0 ? window.days : 30);

  const fetchReport = useCallback(
    async (currentDays: number, fresh = false) => {
      const version = ++reportVersion.current;
      setData((current) => (current?.days === currentDays ? current : null));
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/admin/campaign-performance?days=${currentDays}&campaign=${encodeURIComponent(slug)}${fresh ? '&fresh=1' : ''}`
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          if (version === reportVersion.current)
            setError(body?.error ?? `Failed to fetch report (${res.status})`);
          return;
        }
        const report = (await res.json()) as PerformanceResponse;
        if (version === reportVersion.current) setData(report);
      } catch {
        if (version === reportVersion.current) setError('Network error');
      } finally {
        if (version === reportVersion.current) setLoading(false);
      }
    },
    [slug]
  );

  useEffect(() => {
    void fetchReport(days);
    return () => {
      reportVersion.current += 1;
    };
  }, [days, fetchReport]);

  const sessionKey = campaignSessionIds(campaign).join(',');
  const events = useEvents();
  useEffect(() => {
    if (sessionKey) events.load();
  }, [sessionKey, events.load]);
  const [eventBookings, setEventBookings] = useState<CombinedEventBookings | null>(null);
  const [eventError, setEventError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const fetchEventBookings = useCallback(
    async (fresh = false) => {
      const version = ++requestVersion.current;
      setEventBookings(null);
      setEventError(null);
      if (!sessionKey) return;
      try {
        const res = await fetch(
          `/api/admin/event-bookings?events=${encodeURIComponent(sessionKey)}${fresh ? '&fresh=1' : ''}`
        );
        const body = await res.json();
        if (version !== requestVersion.current) return;
        if (!res.ok) {
          setEventError(body.error ?? 'Could not read the selected slots.');
          return;
        }
        setEventBookings(body as CombinedEventBookings);
      } catch {
        if (version === requestVersion.current) setEventError('Could not read the selected slots.');
      }
    },
    [sessionKey]
  );
  useEffect(() => {
    void fetchEventBookings();
    return () => {
      requestVersion.current += 1;
    };
  }, [fetchEventBookings]);
  // Never render a previous selection's totals, even before the effect runs.
  const currentBookings =
    eventBookings?.sessions.map((session) => session.sessionId).join(',') === sessionKey
      ? eventBookings
      : null;

  const row = data?.campaigns[0];
  const liveClicks = useMemo(() => links.reduce((n, l) => n + l.clicks, 0), [links]);

  const breakdown = useMemo(
    () =>
      row?.linkPerformance ??
      reconcileLinks(
        links.map((link) => ({
          ...EMPTY_LINK_COUNTS,
          id: link.id,
          label: linkTitle(link),
          url: link.url,
          tags: null,
          clicks: link.clicks,
        })),
        { ...EMPTY_LINK_COUNTS, clicks: liveClicks }
      ),
    [row, links, liveClicks]
  );
  const segments = (metric: LinkMetric | 'signups') =>
    breakdown.map((link) => ({
      id: link.id,
      label: link.label,
      value: metric === 'signups' ? link.introOfferSignups + link.mailingListSignups : link[metric],
    }));
  const analyticsAvailable = Boolean(
    data?.posthog.configured && (!data.posthog.error || data.stale)
  );

  // A metric whose event has never reached PostHog reads zero for want of
  // instrumentation; the goal says so instead of calling the campaign behind.
  const isTracked = useCallback(
    (metric: string) => {
      const event = goalMetricDef(metric)?.event ?? '';
      if (!event || !data) return true;
      return data.posthog.configured && !data.posthog.missingEvents.includes(event);
    },
    [data]
  );

  const progress = useMemo<GoalProgress[]>(() => {
    if (campaign.goals.length === 0) return [];
    const measurements = measurementsOf({
      shortlinkClicks: row?.shortlinkClicks ?? liveClicks,
      visitors: row?.visitors ?? 0,
      mailingListSignups: row?.mailingListSignups ?? 0,
      introOfferSignups: row?.introOfferSignups ?? 0,
      bookings: row?.bookings ?? 0,
      introPurchases: row?.introPurchases ?? 0,
      creditPacks: row?.creditPacks ?? 0,
      memberships: row?.memberships ?? 0,
    });
    const phase = campaignPhase(campaign, today);
    const elapsed = elapsedFraction(campaign, today);
    return campaign.goals.map((goal) =>
      goalProgress(goal, {
        value: measurements[goal.metric],
        phase,
        elapsed,
        tracked: isTracked(goal.metric),
      })
    );
  }, [campaign, row, liveClicks, today, isTracked]);

  const metGoals = progress.filter((p) => p.state === 'hit').length;

  const posthogIssue = data
    ? !data.posthog.configured
      ? 'PostHog querying is not configured. Showing link clicks only. Set POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID on the pyre-integrations Vercel project (Production) and redeploy.'
      : data.posthog.error
        ? data.stale
          ? `PostHog query failed. Showing the last successful report from ${new Date(data.generatedAt).toLocaleString()}.`
          : `PostHog query failed: ${data.posthog.error}`
        : null
    : null;

  const stat = (label: string, value: number | undefined, metric: LinkMetric | 'signups') => (
    <div className="rounded border border-white/10 bg-white/5 px-3 py-2">
      <div className="font-mono text-[10px] uppercase tracking-wide text-white/40">{label}</div>
      <div className="font-mono-bold text-lg text-[var(--pyre-creme)] tabular-nums">
        {value ?? '–'}
      </div>
      {(metric === 'clicks' || analyticsAvailable) && value !== undefined && (
        <div className="mt-2">
          <LinkBar label={label} total={value} segments={segments(metric)} />
        </div>
      )}
    </div>
  );

  return (
    <section className={cardClass}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle
          note={`Traffic and conversions are broken down by campaign link. Conversions use first-touch attribution where available, with click inference as a fallback. Campaign-attributed bookings count completed reservations; the event bookings total counts people. Clicks are live from the short links.${
            sessionKey
              ? ' The event booking total comes from Momence across the selected slots, counting every booking however it arrived.'
              : ''
          }`}
        >
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
            onClick={() => {
              void fetchReport(days, true);
              void fetchEventBookings(true);
            }}
            disabled={loading}
            className="px-3 py-1.5 rounded text-xs font-mono-bold uppercase tracking-wide border border-white/20 text-white/60 hover:text-white hover:border-white/40 transition-colors disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {posthogIssue && <p className="mb-3 text-xs text-[var(--pyre-gold)]">{posthogIssue}</p>}
      {error && <p className="mb-3 text-xs text-[var(--pyre-red)]">{error}</p>}

      {progress.length > 0 && (
        <div className="mb-4 rounded border border-white/10 bg-white/[0.02] p-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wide text-white/40">
              Goals
            </span>
            <span className="font-mono text-[10px] text-white/40 tabular-nums">
              {metGoals} of {progress.length} met
            </span>
          </div>
          <ul className="space-y-3">
            {progress.map((goal) => (
              <li key={goal.metric} className="space-y-1">
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="text-white/70">{goal.label}</span>
                  <span className="font-mono text-[var(--pyre-creme)] tabular-nums">
                    {goal.value}
                    <span className="text-white/35"> / {goal.target}</span>
                  </span>
                </div>
                <LinkBar
                  label={goal.label}
                  total={goal.value}
                  target={goal.target}
                  pace={goal.expected}
                  segments={segments(goal.metric)}
                />
                <div className="flex flex-wrap items-baseline justify-between gap-2 font-mono text-[10px]">
                  <span className={STATE_TEXT[goal.state]}>{GOAL_STATE_LABEL[goal.state]}</span>
                  {goal.state !== 'untracked' && goal.expected !== null && (
                    <span className="text-white/35 tabular-nums">
                      {goal.expected} expected by now
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {!window.coversRun && (
            <p className="mt-3 text-[10px] text-white/35">
              This campaign started more than 90 days ago, and the report only reaches back 90 days,
              so goal counts miss its opening stretch.
            </p>
          )}
          {window.coversRun && days < window.days && (
            <p className="mt-3 text-[10px] text-white/35">
              The last {days} days is shorter than this campaign's run. Switch to {window.days}d to
              count all of it.
            </p>
          )}
        </div>
      )}

      {campaign.goals.length === 0 && (
        <p className="mb-3 text-xs text-white/40">
          No goals set. Edit the campaign to say what it should produce, and this panel will read
          the numbers against it.
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {stat('Clicks', row?.shortlinkClicks ?? liveClicks, 'clicks')}
        {stat('Pageviews', row?.pageviews, 'pageviews')}
        {stat('Visitors', row?.visitors, 'visitors')}
        {stat(
          'Signups',
          row ? row.introOfferSignups + row.mailingListSignups : undefined,
          'signups'
        )}
        {stat('Campaign-attributed bookings', row?.bookings, 'bookings')}
        {stat('Intro purchases', row?.introPurchases, 'introPurchases')}
        {stat('Packs', row?.creditPacks, 'creditPacks')}
        {stat('Memberships', row?.memberships, 'memberships')}
      </div>

      {sessionKey && (
        <section className="mt-4 space-y-2">
          <h3 className="text-sm">Selected slots · Momence totals</h3>
          <p className="text-xs text-white/45">
            Current totals across all booking dates. Campaign-attributed bookings above may include
            other sessions and follow the selected report period.
          </p>
          {currentBookings ? (
            <>
              <div className="rounded border border-[var(--pyre-sage)]/40 bg-[var(--pyre-sage)]/10 p-4">
                <h4 className="text-sm text-white/70">Bookings</h4>
                <p className="mt-1 text-3xl font-mono tabular-nums text-[var(--pyre-creme)]">
                  {currentBookings.seats}
                </p>
                <p className="mt-1 text-xs text-white/50">
                  Across {currentBookings.sessions.length} selected slots
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr>
                      {['Slot', 'Bookings'].map((label) => (
                        <th key={label} className="p-2">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {currentBookings.sessions.map((session) => {
                      const event = events.items?.find((item) => item.id === session.sessionId);
                      return (
                        <tr key={session.sessionId}>
                          <td className="p-2">
                            {event ? eventLabel(event) : `Slot ${session.sessionId}`}
                          </td>
                          <td className="p-2 tabular-nums">{session.seats}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-white/40">
                Bookings count people attending. A group of three counts as three bookings. Someone
                booked into two slots counts in each slot. Oldest slot update:{' '}
                {new Date(currentBookings.generatedAt).toLocaleString()}.
              </p>
            </>
          ) : (
            <p className="text-xs text-white/50">
              {eventError ?? 'Reading selected slots from Momence…'}
            </p>
          )}
        </section>
      )}

      <LinkBreakdown links={breakdown} conversionsAvailable={analyticsAvailable} />

      {data && (
        <p className="mt-3 font-mono text-[10px] text-white/35">
          Last {data.days} days. Generated {new Date(data.generatedAt).toLocaleString()}
          {data.stale ? ' (stale)' : data.cached ? ' (cached, refresh for live data)' : ''}
        </p>
      )}
    </section>
  );
}

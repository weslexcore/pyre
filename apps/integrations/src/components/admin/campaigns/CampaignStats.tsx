// How one campaign is doing: its goals read against the shared, cached
// performance report for its slug (PostHog traffic and conversions), plus
// live short-link clicks per placement (from Redis, via the links already
// loaded on the page).
//
// The window defaults to the shortest report window that still reaches back
// to the day the campaign started, so a goal is read against the whole run
// rather than an arbitrary 30 days.
//
// A campaign built around one event also reads that event's own booking total
// from Momence, so the attributed number has a denominator: the rest of the
// event's bookings came from somewhere this campaign cannot claim.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  campaignEventId,
  type EventBookings,
  eventBookingSummary,
} from '@/lib/campaigns/event-bookings';
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
import { campaignPhase, todayYmd } from '@/lib/campaigns/phase';
import type { LinkRow, UtmCampaign } from '@/lib/campaigns/types';
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

const STATE_TEXT: Record<GoalState, string> = {
  hit: 'text-[var(--pyre-sage)]',
  ahead: 'text-[var(--pyre-sage)]',
  'on-track': 'text-white/60',
  behind: 'text-[var(--pyre-gold)]',
  missed: 'text-[var(--pyre-red)]',
  running: 'text-white/50',
  untracked: 'text-[var(--pyre-gold)]',
};

const STATE_BAR: Record<GoalState, string> = {
  hit: 'bg-[var(--pyre-sage)]',
  ahead: 'bg-[var(--pyre-sage)]',
  'on-track': 'bg-[var(--pyre-sage)]/70',
  behind: 'bg-[var(--pyre-gold)]/80',
  missed: 'bg-[var(--pyre-red)]/70',
  running: 'bg-white/40',
  untracked: 'bg-white/15',
};

function GoalBar({ progress }: { progress: GoalProgress }) {
  const filled = Math.min(100, Math.round(progress.pct * 100));
  const pace =
    progress.expected !== null && progress.target > 0
      ? Math.min(100, Math.round((progress.expected / progress.target) * 100))
      : null;
  return (
    <div className="relative h-2 overflow-hidden rounded bg-white/5">
      <div
        className={`h-full rounded ${STATE_BAR[progress.state]}`}
        style={{ width: `${filled}%` }}
      />
      {pace !== null && pace > 0 && pace < 100 && (
        // Where the campaign should be by now, if its dates are to be believed.
        <span
          aria-hidden="true"
          className="absolute inset-y-0 w-px bg-white/50"
          style={{ left: `${pace}%` }}
        />
      )}
    </div>
  );
}

export function CampaignStats({ campaign, links }: { campaign: UtmCampaign; links: LinkRow[] }) {
  const slug = campaign.slug;
  const today = useMemo(() => todayYmd(), []);
  const window = useMemo(() => goalWindow(campaign, today), [campaign, today]);

  const [data, setData] = useState<PerformanceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Goals are read against the whole run; without any, 30 days is the habit.
  const [days, setDays] = useState<number>(campaign.goals.length > 0 ? window.days : 30);

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

  // An event campaign names the Momence session its links open; that session's
  // booking list is what "every booking for this event" means.
  const eventId = useMemo(() => campaignEventId(campaign), [campaign]);

  const [eventBookings, setEventBookings] = useState<EventBookings | null>(null);
  const [eventError, setEventError] = useState<string | null>(null);

  const fetchEventBookings = useCallback(
    async (fresh = false) => {
      if (!eventId) return;
      setEventError(null);
      try {
        const res = await fetch(
          `/api/admin/event-bookings?event=${encodeURIComponent(eventId)}${fresh ? '&fresh=1' : ''}`
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setEventError(body?.error ?? `Could not read this event's bookings (${res.status})`);
          return;
        }
        setEventBookings((await res.json()) as EventBookings);
      } catch {
        setEventError("Could not read this event's bookings.");
      }
    },
    [eventId]
  );

  useEffect(() => {
    void fetchEventBookings();
  }, [fetchEventBookings]);

  const row = data?.campaigns[0];
  const maxClicks = useMemo(() => Math.max(1, ...links.map((l) => l.clicks)), [links]);
  const sorted = useMemo(() => [...links].sort((a, b) => b.clicks - a.clicks), [links]);
  const liveClicks = useMemo(() => links.reduce((n, l) => n + l.clicks, 0), [links]);

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

  const eventSummary = useMemo(
    () => (eventBookings ? eventBookingSummary(eventBookings, row?.bookings ?? null) : null),
    [eventBookings, row]
  );

  const posthogIssue = data
    ? !data.posthog.configured
      ? 'PostHog querying is not configured. Showing link clicks only.'
      : data.posthog.error
        ? data.stale
          ? `PostHog query failed. Showing the last successful report from ${new Date(data.generatedAt).toLocaleString()}.`
          : `PostHog query failed: ${data.posthog.error}`
        : null
    : null;

  const stat = (label: string, value: number | undefined, note?: string) => (
    <div className="rounded border border-white/10 bg-white/5 px-3 py-2">
      <div className="font-mono text-[10px] uppercase tracking-wide text-white/40">{label}</div>
      <div className="font-mono-bold text-lg text-[var(--pyre-creme)] tabular-nums">
        {value ?? '–'}
      </div>
      {note && <div className="font-mono text-[10px] text-white/35 tabular-nums">{note}</div>}
    </div>
  );

  return (
    <section className={cardClass}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle
          note={`Visits, signups, bookings and purchases are first-touch attributed by utm_campaign in PostHog. Clicks are live from the short links.${
            eventId
              ? " The event's booking total comes from Momence, counting every booking however it arrived."
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
                <GoalBar progress={goal} />
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
        {stat('Clicks', row?.shortlinkClicks ?? liveClicks)}
        {stat('Pageviews', row?.pageviews)}
        {stat('Visitors', row?.visitors)}
        {stat('Signups', row ? row.introOfferSignups + row.mailingListSignups : undefined)}
        {stat(
          'Bookings',
          row?.bookings,
          eventBookings ? `of ${eventBookings.bookings} on this event` : undefined
        )}
        {stat('Intro purchases', row?.introPurchases)}
        {stat('Packs', row?.creditPacks)}
        {stat('Memberships', row?.memberships)}
      </div>

      {eventId && (
        <p className="mt-2 text-[11px] text-white/45">
          {eventSummary ?? (eventError ? null : "Reading this event's bookings from Momence…")}
          {eventError && (
            <span className="text-[var(--pyre-gold)]">
              {eventSummary ? ` ${eventError}` : eventError}
            </span>
          )}
        </p>
      )}

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

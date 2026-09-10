// Campaign goals: the numbers a campaign commits to before it runs, and how
// far along it is against them.
//
// Every metric here is a column the campaign performance report already
// produces, so a goal never needs measurement of its own — it reads the same
// report the stats panel does. Client-bundle-safe: only type imports from the
// store, and the metric catalog is spelled out here the way CAMPAIGN_TYPES is
// (the store validates what it persists; this file is what the tool shows).

import type { CampaignPhase } from './phase';
import type { CampaignGoal, CampaignGoalMetric, UtmCampaign } from './types';

export interface GoalMetricDef {
  key: CampaignGoalMetric;
  label: string;
  hint: string;
  /** The PostHog event behind it; '' for numbers that come from Redis. */
  event: string;
}

/** Goal metrics in the order the form and the progress list show them:
 * reach first, then the conversions that pay for the campaign. */
export const GOAL_METRICS: ReadonlyArray<GoalMetricDef> = [
  {
    key: 'clicks',
    label: 'Link clicks',
    hint: 'Taps on this campaign’s short links.',
    event: '',
  },
  {
    key: 'visitors',
    label: 'Visitors',
    hint: 'People who reached the site from it.',
    event: '',
  },
  {
    key: 'mailingListSignups',
    label: 'Email signups',
    hint: 'Joined the mailing list.',
    event: 'Mailing List Signup',
  },
  {
    key: 'introOfferSignups',
    label: 'Intro offer signups',
    hint: 'Asked for the intro offer on the site.',
    event: 'Intro Offer Signup',
  },
  {
    key: 'bookings',
    label: 'Bookings',
    hint: 'Sessions booked in Momence.',
    event: 'booking_completed',
  },
  {
    key: 'introPurchases',
    label: 'Intro offers bought',
    hint: 'Paid for the intro offer.',
    event: 'purchase_completed',
  },
  {
    key: 'creditPacks',
    label: 'Credit packs sold',
    hint: 'Bought a pack of credits.',
    event: 'purchase_completed',
  },
  {
    key: 'memberships',
    label: 'Memberships started',
    hint: 'Started paying monthly.',
    event: 'purchase_completed',
  },
];

/** One goal per metric, and a cap so the form stays a short list. */
export const MAX_GOALS = 6;
export const MAX_GOAL_TARGET = 1_000_000;

export function goalMetricDef(metric: string): GoalMetricDef | undefined {
  return GOAL_METRICS.find((m) => m.key === metric);
}

export function goalMetricLabel(metric: string): string {
  return goalMetricDef(metric)?.label ?? metric;
}

/** The report numbers a goal can be read against, whatever the shape of the
 * row they came from (the report calls clicks `shortlinkClicks`). */
export interface GoalMeasurements {
  clicks: number;
  visitors: number;
  mailingListSignups: number;
  introOfferSignups: number;
  bookings: number;
  introPurchases: number;
  creditPacks: number;
  memberships: number;
}

export function measurementsOf(row: {
  shortlinkClicks: number;
  visitors: number;
  mailingListSignups: number;
  introOfferSignups: number;
  bookings: number;
  introPurchases: number;
  creditPacks: number;
  memberships: number;
}): GoalMeasurements {
  return { ...row, clicks: row.shortlinkClicks };
}

/**
 * Where a campaign stands on one goal.
 *
 * `untracked` beats every other verdict: a metric whose event has never
 * reached PostHog reads zero for want of instrumentation, and calling that
 * "behind" would be a lie about the campaign.
 */
export type GoalState =
  | 'hit'
  | 'ahead'
  | 'on-track'
  | 'behind'
  | 'missed'
  | 'running'
  | 'untracked';

export const GOAL_STATE_LABEL: Record<GoalState, string> = {
  hit: 'Goal hit',
  ahead: 'Ahead of pace',
  'on-track': 'On pace',
  behind: 'Behind pace',
  missed: 'Missed',
  running: 'Running',
  untracked: 'Not measured yet',
};

export interface GoalProgress {
  metric: CampaignGoalMetric;
  label: string;
  target: number;
  value: number;
  /** value / target, 0 and up (can exceed 1). */
  pct: number;
  /** Where the campaign should be by now; null when nothing sets a pace. */
  expected: number | null;
  state: GoalState;
}

// A campaign is judged against pace, not against the finish line, while it is
// still running. These are the bands: comfortably ahead, near enough, behind.
const AHEAD_RATIO = 1.1;
const ON_TRACK_RATIO = 0.75;

export function goalProgress(
  goal: CampaignGoal,
  input: { value: number; phase: CampaignPhase; elapsed: number | null; tracked?: boolean }
): GoalProgress {
  const { value, phase, elapsed, tracked = true } = input;
  const target = goal.target > 0 ? goal.target : 0;
  const pct = target > 0 ? value / target : 0;
  const expected = elapsed === null || target === 0 ? null : Math.round(target * elapsed);

  const state: GoalState = !tracked
    ? 'untracked'
    : target > 0 && value >= target
      ? 'hit'
      : phase === 'ended' || phase === 'archived'
        ? 'missed'
        : expected === null || expected <= 0
          ? 'running'
          : value / expected >= AHEAD_RATIO
            ? 'ahead'
            : value / expected >= ON_TRACK_RATIO
              ? 'on-track'
              : 'behind';

  return {
    metric: goal.metric,
    label: goalMetricLabel(goal.metric),
    target,
    value,
    pct,
    expected,
    state,
  };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days from one calendar day to another; null when either is unusable. */
export function daysBetween(fromYmd: string, toYmd: string): number | null {
  const from = Date.parse(`${fromYmd}T00:00:00Z`);
  const to = Date.parse(`${toYmd}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / MS_PER_DAY);
}

/**
 * How much of the run is behind us, 0 to 1. Null unless the campaign has both
 * ends of its run: without them there is no pace to hold it to, only a total.
 */
export function elapsedFraction(
  campaign: Pick<UtmCampaign, 'startsAt' | 'endsAt'>,
  today: string
): number | null {
  if (!campaign.startsAt || !campaign.endsAt) return null;
  const length = daysBetween(campaign.startsAt, campaign.endsAt);
  const gone = daysBetween(campaign.startsAt, today);
  if (length === null || gone === null) return null;
  // Both ends inclusive: a one-day campaign is a whole day long, not zero.
  const total = length + 1;
  if (total <= 0) return null;
  return Math.min(1, Math.max(0, (gone + 1) / total));
}

/** The report windows the performance API will accept. */
export const REPORT_WINDOWS = [7, 30, 90] as const;

/**
 * The report window to read a campaign's goals against: the shortest one that
 * still reaches back to the day it started (falling back to the day it was
 * created, for campaigns that never got dates). `coversRun` is false when the
 * run is older than the longest window, so the panel can say the counts are
 * only the tail of it.
 */
export function goalWindow(
  campaign: Pick<UtmCampaign, 'startsAt' | 'createdAt'>,
  today: string
): { days: number; coversRun: boolean } {
  const start = campaign.startsAt || new Date(campaign.createdAt).toISOString().slice(0, 10) || '';
  const elapsed = start ? daysBetween(start, today) : null;
  if (elapsed === null) return { days: 30, coversRun: false };
  const longest = REPORT_WINDOWS[REPORT_WINDOWS.length - 1];
  const days = REPORT_WINDOWS.find((w) => w >= elapsed) ?? longest;
  return { days, coversRun: elapsed <= longest };
}

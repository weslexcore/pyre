// The Performance tab: how a journey is doing without leaving it. Two halves:
//   * Emails — people entering, finishing and leaving (and why), and each
//     step's sends, deliveries, opens, clicks and skips, from the journey's
//     own send log and step log.
//   * Website results — visits, signups, bookings and purchases its links
//     brought in, read against the linked campaign's goals: the Campaigns
//     tool's own CampaignStats panel, for the journey's linked campaign.

import { useState } from 'react';
import { CampaignStats } from '@/components/admin/campaigns/CampaignStats';
import { ErrorBanner } from '@/components/admin/ErrorBanner';
import { InfoTip } from '@/components/admin/InfoTip';
import type { CampaignDetailResponse } from '@/lib/campaigns/types';
import { useCachedJson } from '@/lib/client/cachedJson';
import { fmtShortDate } from '@/lib/client/format';
import type { JourneyPerformanceResponse } from '@/lib/email/journeys/api-types';
import { Section } from './Field';
import { buttonClass, pct, pillClass } from './journeyUi';
import type { CampaignChoice } from './OverviewPanel';

const DAY_OPTIONS = [7, 30, 90] as const;

const TIPS = {
  entered: 'People who entered the journey in this period.',
  active: 'Everyone in the journey right now, whenever they entered.',
  finished: 'People who reached the last step in this period.',
  left: 'People taken out early in this period - by an exit rule, unsubscribing, or by hand.',
  sent: 'Emails this journey sent in this period.',
  clicked:
    'Share of sent emails where the person clicked a link. The most reliable sign an email worked.',
  opened:
    'Share of sent emails that were opened. Apple Mail opens every email automatically for privacy, so this runs high - lean on clicks.',
} as const;

function Tile({
  label,
  value,
  sub,
  tip,
}: {
  label: string;
  value: string;
  sub?: string;
  tip: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <p className="flex items-center gap-1.5 text-xs text-white/55">
        {label}
        <InfoTip label={label} text={tip} />
      </p>
      <p className="mt-1 font-mono text-2xl text-[var(--pyre-creme)]">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-white/40">{sub}</p>}
    </div>
  );
}

/** A thin single-hue bar for a rate, beside its number. */
function RateBar({ part, whole }: { part: number; whole: number }) {
  const share = whole > 0 ? Math.min(1, part / whole) : 0;
  return (
    <span className="flex items-center gap-2">
      <span className="w-10 text-right font-mono">{pct(part, whole)}</span>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
        <span
          className="block h-full rounded-full bg-[var(--pyre-gold)]"
          style={{ width: `${Math.round(share * 100)}%` }}
        />
      </span>
    </span>
  );
}

export function PerformancePanel({
  journeyId,
  campaignSlug,
  campaigns,
  onOpenSettings,
}: {
  journeyId: string;
  /** The saved definition's linked campaign. */
  campaignSlug: string | undefined;
  campaigns: CampaignChoice[];
  onOpenSettings: () => void;
}) {
  const [days, setDays] = useState<(typeof DAY_OPTIONS)[number]>(30);
  const { data, error, loading } = useCachedJson<JourneyPerformanceResponse>(
    `/api/admin/journeys/${journeyId}/performance?days=${days}`,
    { maxAgeMs: 60_000 }
  );
  const campaign = campaignSlug ? campaigns.find((c) => c.slug === campaignSlug) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-sm text-white/60">Last</span>
        {DAY_OPTIONS.map((d) => (
          <button
            key={d}
            type="button"
            className={pillClass(days === d)}
            onClick={() => setDays(d)}
          >
            {d} days
          </button>
        ))}
        {loading && <span className="ml-2 text-xs text-white/40">Loading...</span>}
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Tile label="Entered" value={String(data.entered)} tip={TIPS.entered} />
            <Tile label="In it now" value={String(data.active)} tip={TIPS.active} />
            <Tile label="Finished" value={String(data.finished)} tip={TIPS.finished} />
            <Tile label="Left early" value={String(data.left)} tip={TIPS.left} />
            <Tile label="Emails sent" value={String(data.totals.sent)} tip={TIPS.sent} />
            <Tile
              label="Click rate"
              value={pct(data.totals.clicked, data.totals.sent)}
              sub={`Opened ${pct(data.totals.opened, data.totals.sent)}`}
              tip={TIPS.clicked}
            />
          </div>

          <Section
            title="Each step"
            description={
              data.stepLogSince
                ? `Skips are counted from ${fmtShortDate(data.stepLogSince)}, when the step log started.`
                : 'Skips are counted once the step log has recorded something.'
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead className="text-xs text-white/50">
                  <tr className="border-b border-white/10">
                    <th className="py-2 pr-3 font-medium">Step</th>
                    <th className="py-2 pr-3 text-right font-medium">Sent</th>
                    <th className="py-2 pr-3 font-medium">Delivered</th>
                    <th className="py-2 pr-3 font-medium">
                      <span className="flex items-center gap-1">
                        Opened <InfoTip label="opened" text={TIPS.opened} />
                      </span>
                    </th>
                    <th className="py-2 pr-3 font-medium">
                      <span className="flex items-center gap-1">
                        Clicked <InfoTip label="clicked" text={TIPS.clicked} />
                      </span>
                    </th>
                    <th className="py-2 pr-3 text-right font-medium">Bounced</th>
                    <th className="py-2 font-medium">Skipped</th>
                  </tr>
                </thead>
                <tbody>
                  {data.steps.map((s, i) => (
                    <tr key={s.key} className="border-b border-white/5 align-top">
                      <td className="py-2 pr-3">
                        <span className="text-[var(--pyre-creme)]">
                          {i + 1}. {s.name}
                        </span>
                        {s.archived && <span className="ml-2 text-xs text-white/40">archived</span>}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">{s.sent}</td>
                      <td className="py-2 pr-3 text-white/70">
                        <RateBar part={s.delivered} whole={s.sent} />
                      </td>
                      <td className="py-2 pr-3 text-white/70">
                        <RateBar part={s.opened} whole={s.sent} />
                      </td>
                      <td className="py-2 pr-3 text-white/70">
                        <RateBar part={s.clicked} whole={s.sent} />
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-white/70">{s.bounced}</td>
                      <td className="py-2 text-white/70">
                        <span className="font-mono">{s.skipped}</span>
                        {s.skipReasons.map((r) => (
                          <span key={r.reason} className="block text-[11px] text-white/45">
                            {r.count} - {r.reason}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.steps.length === 0 && <p className="text-sm text-white/40">No steps yet.</p>}
          </Section>

          <Section title="Why people left early">
            {data.leaveReasons.length === 0 ? (
              <p className="text-sm text-white/45">Nobody left early in this period.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {data.leaveReasons.map((r) => (
                  <li key={r.reason} className="flex gap-3">
                    <span className="w-10 text-right font-mono text-white/70">{r.count}</span>
                    <span className="text-white/80">{r.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}

      <Section
        title="Website results"
        description="Visits, signups, bookings and purchases this journey's links brought in, from its linked campaign."
      >
        {campaign ? (
          <LinkedCampaignStats campaignId={campaign.id} />
        ) : (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-white/60">
              {campaignSlug
                ? `Links are tagged "${campaignSlug}", but no campaign in the Campaigns tool has that name, so there is nothing to report against.`
                : 'This journey is not linked to a campaign yet. Link one (or create one in a click) and its website results show here.'}
            </p>
            <button type="button" className={buttonClass} onClick={onOpenSettings}>
              Link a campaign in Settings
            </button>
          </div>
        )}
      </Section>
    </div>
  );
}

function LinkedCampaignStats({ campaignId }: { campaignId: string }) {
  const { data, error } = useCachedJson<CampaignDetailResponse>(
    `/api/admin/campaigns/${encodeURIComponent(campaignId)}`
  );
  if (error) return <ErrorBanner>{error}</ErrorBanner>;
  if (!data) return <p className="text-sm text-white/40">Loading campaign...</p>;
  return (
    <div className="flex flex-col gap-2">
      <a
        href={`/admin/campaigns/${encodeURIComponent(campaignId)}`}
        className="self-start text-xs text-white/50 underline hover:text-white/80"
      >
        Open {data.campaign.name} in Campaigns
      </a>
      <CampaignStats campaign={data.campaign} links={data.links} />
    </div>
  );
}

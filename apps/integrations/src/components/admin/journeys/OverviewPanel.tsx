// The Overview tab: what starts the journey, who may enter, what takes them
// out, how often someone can go through it again, and the tags written at
// the end — plus an estimate of who an audience journey would enroll.

import { useState } from 'react';
import { ErrorBanner } from '@/components/admin/ErrorBanner';
import { sendJson } from '@/lib/client/api';
import type { AudienceResponse } from '@/lib/email/journeys/api-types';
import {
  type JourneyDefinition,
  TRIGGER_TYPES,
  TRIGGERS,
  type Trigger,
} from '@/lib/email/journeys/schema';
import {
  buttonClass,
  cardClass,
  compactInputClass,
  compactSelectClass,
  labelClass,
  microLabelClass,
  sectionHeading,
} from './journeyUi';
import { ActionList, ConditionList, TagListInput } from './RuleLists';

export function OverviewPanel({
  journeyId,
  journeyName,
  definition,
  onChange,
  tags,
  campaigns,
}: {
  journeyId: string;
  journeyName: string;
  definition: JourneyDefinition;
  onChange: (next: JourneyDefinition) => void;
  tags: string[];
  campaigns: CampaignChoice[];
}) {
  const set = (patch: Partial<JourneyDefinition>) => onChange({ ...definition, ...patch });
  const trigger = definition.trigger;
  const sessionTrigger = trigger.type === 'session-booked';

  const setTriggerType = (type: Trigger['type']) => {
    if (type === trigger.type) return;
    const next: Trigger =
      type === 'session-booked'
        ? { type, firstBookingOnly: false }
        : type === 'sweep'
          ? { type, withTags: [], withoutTags: [], withActivePurchase: false }
          : { type };
    set({ trigger: next });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className={`${cardClass} flex flex-col gap-3`}>
        <p className={sectionHeading}>About</p>
        <textarea
          rows={3}
          className={`${compactInputClass} w-full`}
          placeholder="What this journey is for (only staff see this)"
          value={definition.description}
          onChange={(e) => set({ description: e.target.value })}
        />
      </section>

      <CampaignSection
        journeyId={journeyId}
        journeyName={journeyName}
        value={definition.campaign}
        campaigns={campaigns}
        onChange={(campaign) => set({ campaign })}
      />

      <section className={`${cardClass} flex flex-col gap-3`}>
        <p className={sectionHeading}>Starts when someone</p>
        <select
          className={compactSelectClass}
          value={trigger.type}
          onChange={(e) => setTriggerType(e.target.value as Trigger['type'])}
        >
          {TRIGGER_TYPES.map((t) => (
            <option key={t} value={t}>
              {TRIGGERS[t].label}
            </option>
          ))}
        </select>
        <p className="text-xs text-white/40">{TRIGGERS[trigger.type].description}</p>

        {trigger.type === 'session-booked' && (
          <label className="flex items-center gap-2 text-sm text-white/70">
            <input
              type="checkbox"
              checked={trigger.firstBookingOnly}
              onChange={(e) => set({ trigger: { ...trigger, firstBookingOnly: e.target.checked } })}
            />
            Only their first-ever booking
          </label>
        )}

        {trigger.type === 'sweep' && (
          <label className="flex items-center gap-2 text-sm text-white/70">
            <input
              type="checkbox"
              checked={trigger.withActivePurchase}
              onChange={(e) =>
                set({ trigger: { ...trigger, withActivePurchase: e.target.checked } })
              }
            />
            Only people with an active membership or credit pack
          </label>
        )}
        {trigger.type === 'sweep' && (
          <div className="grid gap-2 sm:grid-cols-2">
            <label>
              <span className={microLabelClass}>Not seen for at least (days)</span>
              <input
                type="number"
                min={1}
                className={`${compactInputClass} mt-1 w-full`}
                value={trigger.inactiveDays ?? ''}
                placeholder="Any"
                onChange={(e) =>
                  set({
                    trigger: {
                      ...trigger,
                      inactiveDays: e.target.value ? Number(e.target.value) : undefined,
                    },
                  })
                }
              />
            </label>
            <label>
              <span className={microLabelClass}>...but seen within (days)</span>
              <input
                type="number"
                min={1}
                className={`${compactInputClass} mt-1 w-full`}
                value={trigger.maxInactiveDays ?? ''}
                placeholder="Any time"
                onChange={(e) =>
                  set({
                    trigger: {
                      ...trigger,
                      maxInactiveDays: e.target.value ? Number(e.target.value) : undefined,
                    },
                  })
                }
              />
            </label>
            <label>
              <span className={microLabelClass}>Checked-in visits at least</span>
              <input
                type="number"
                min={0}
                className={`${compactInputClass} mt-1 w-full`}
                value={trigger.minVisits ?? ''}
                placeholder="Any"
                onChange={(e) =>
                  set({
                    trigger: {
                      ...trigger,
                      minVisits: e.target.value ? Number(e.target.value) : undefined,
                    },
                  })
                }
              />
            </label>
            <div>
              <span className={microLabelClass}>Has all of these tags</span>
              <div className="mt-1">
                <TagListInput
                  value={trigger.withTags}
                  onChange={(withTags) => set({ trigger: { ...trigger, withTags } })}
                  tags={tags}
                  placeholder="Comma separated"
                />
              </div>
            </div>
            <div>
              <span className={microLabelClass}>Has none of these tags</span>
              <div className="mt-1">
                <TagListInput
                  value={trigger.withoutTags}
                  onChange={(withoutTags) => set({ trigger: { ...trigger, withoutTags } })}
                  tags={tags}
                  placeholder="Comma separated"
                />
              </div>
            </div>
          </div>
        )}
        {trigger.type === 'sweep' && (
          <AudienceEstimate journeyId={journeyId} definition={definition} />
        )}
      </section>

      <section className={`${cardClass} flex flex-col gap-2`}>
        <p className={sectionHeading}>Only enroll people who</p>
        <ConditionList
          conditions={definition.enrollIf}
          onChange={(enrollIf) => set({ enrollIf })}
          allowSession={sessionTrigger}
          tags={tags}
          emptyText="Everyone the trigger finds enters."
          addLabel="Add requirement"
        />
        <p className="text-xs text-white/40">All of these must be true, checked when they enter.</p>
      </section>

      <section className={`${cardClass} flex flex-col gap-2`}>
        <p className={sectionHeading}>Take them out if</p>
        <ConditionList
          conditions={definition.exitIf}
          onChange={(exitIf) => set({ exitIf })}
          allowSession={sessionTrigger}
          tags={tags}
          emptyText="They stay until the last step."
          addLabel="Add exit rule"
        />
        <p className="text-xs text-white/40">
          Any one of these, checked against live Momence data before every email.
        </p>
      </section>

      <section className={`${cardClass} flex flex-col gap-2`}>
        <p className={sectionHeading}>Going through it again</p>
        <select
          className={compactSelectClass}
          value={definition.reentry.mode}
          onChange={(e) =>
            set({
              reentry:
                e.target.value === 'once' ? { mode: 'once' } : { mode: 'cooldown', days: 90 },
            })
          }
        >
          <option value="once">Once per person, ever</option>
          <option value="cooldown">Again after a waiting period</option>
        </select>
        {definition.reentry.mode === 'cooldown' && (
          <label className="flex items-center gap-2 text-sm text-white/70">
            Wait
            <input
              type="number"
              min={1}
              className={`${compactInputClass} w-24`}
              value={definition.reentry.days}
              onChange={(e) =>
                set({
                  reentry: { mode: 'cooldown', days: Math.max(1, Number(e.target.value) || 1) },
                })
              }
            />
            days after they finish or leave
          </label>
        )}
      </section>

      <section className={`${cardClass} flex flex-col gap-2`}>
        <p className={sectionHeading}>When they finish or leave</p>
        <ActionList
          actions={definition.onEnd}
          onChange={(onEnd) => set({ onEnd })}
          tags={tags}
          emptyText="Nothing happens."
        />
        <label>
          <span className={labelClass}>Tag after the last step</span>
          <input
            className={`${compactInputClass} w-full`}
            placeholder="Optional, e.g. Review Requested"
            value={definition.completionTag ?? ''}
            onChange={(e) => set({ completionTag: e.target.value || undefined })}
          />
        </label>
      </section>
    </div>
  );
}

function AudienceEstimate({
  journeyId,
  definition,
}: {
  journeyId: string;
  definition: JourneyDefinition;
}) {
  const [result, setResult] = useState<AudienceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(
        await sendJson<AudienceResponse>(`/api/admin/journeys/${journeyId}/audience`, 'POST', {
          definition,
        })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        className={`${buttonClass} self-start`}
        onClick={() => void run()}
        disabled={busy}
      >
        {busy ? 'Checking Momence...' : 'Who would this enroll?'}
      </button>
      {error && <ErrorBanner mono>{error}</ErrorBanner>}
      {result && (
        <div className="text-xs text-white/60">
          <p>
            <span className="text-sm text-[var(--pyre-creme)]">
              {result.checked < result.inAudience ? 'About ' : ''}
              {result.estimated} {result.estimated === 1 ? 'person' : 'people'}
            </span>{' '}
            would enroll right now.
          </p>
          <p className="mt-0.5 text-white/40">
            {result.inAudience} match the audience
            {definition.enrollIf.length > 0
              ? result.checked < result.inAudience
                ? `; ${result.passed} of a sample of ${result.checked} also meet the enroll requirements`
                : `; ${result.passed} also meet the enroll requirements`
              : ''}
            . Read {result.scanned} of {result.totalCandidates} customers
            {result.partial ? ' (stopped early - the real number may be higher)' : ''}. People
            already in, or still cooling down from, this journey are not subtracted.
          </p>
          {result.sample.length > 0 && (
            <p className="mt-0.5 text-white/40">e.g. {result.sample.join(', ')}</p>
          )}
        </div>
      )}
    </div>
  );
}

export interface CampaignChoice {
  id: string;
  slug: string;
  name: string;
  archived: boolean;
}

/**
 * Which Campaigns-tool campaign the journey's email links report into. Its
 * slug becomes utm_campaign on every link, so the journey's visits, bookings
 * and purchases show on that campaign's row on /admin/campaigns.
 */
function CampaignSection({
  journeyId,
  journeyName,
  value,
  campaigns,
  onChange,
}: {
  journeyId: string;
  journeyName: string;
  value: string | undefined;
  campaigns: CampaignChoice[];
  onChange: (slug: string | undefined) => void;
}) {
  const [extra, setExtra] = useState<CampaignChoice[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const all = [...campaigns, ...extra.filter((e) => !campaigns.some((c) => c.slug === e.slug))];
  const current = value ? all.find((c) => c.slug === value) : undefined;
  const options = all.filter((c) => !c.archived || c.slug === value);

  const create = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await sendJson<{ campaign: CampaignChoice; created: boolean }>(
        `/api/admin/journeys/${journeyId}/campaign`,
        'POST',
        { name: journeyName }
      );
      setExtra((prev) => [...prev, result.campaign]);
      onChange(result.campaign.slug);
      setMessage({
        ok: true,
        text: `${result.created ? 'Created' : 'Found the existing'} campaign "${result.campaign.name}". Save the journey to link it.`,
      });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`${cardClass} flex flex-col gap-2`}>
      <p className={sectionHeading}>Campaign</p>
      <select
        className={compactSelectClass}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">Not linked - links are tagged {journeyId}</option>
        {options.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.name}
            {c.archived ? ' (archived)' : ''}
          </option>
        ))}
        {value && !current && <option value={value}>{value} (not in the Campaigns tool)</option>}
      </select>
      <p className="text-xs text-white/40">
        Every link in this journey's emails is tagged utm_campaign=
        <span className="font-mono">{value ?? journeyId}</span>, so its visits, bookings and
        purchases count toward{' '}
        {current ? (
          <a href={`/admin/campaigns/${current.id}`} className="underline hover:text-white/70">
            {current.name}
          </a>
        ) : (
          'that campaign'
        )}{' '}
        on the Campaigns page. Several journeys can share one campaign. Links that already carry a
        campaign keep it.
      </p>
      {!value && (
        <button
          type="button"
          className={`${buttonClass} self-start`}
          onClick={() => void create()}
          disabled={busy}
        >
          {busy ? 'Creating...' : `Create a campaign for this journey`}
        </button>
      )}
      {value && !current && (
        <p className="text-xs text-[var(--pyre-red)]">
          No campaign in the Campaigns tool has this slug, so bookings and purchases won't show on a
          campaign row.
        </p>
      )}
      {message &&
        (message.ok ? (
          <p className="text-xs text-emerald-400">{message.text}</p>
        ) : (
          <ErrorBanner mono>{message.text}</ErrorBanner>
        ))}
    </section>
  );
}

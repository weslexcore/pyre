// The Overview tab, in the order you'd think it through: who enters, what
// takes them out, whether they can go through it again, what happens at the
// end, and which campaign its links report to — plus an estimate of who an
// audience journey would enroll.

import { useId, useState } from 'react';
import { ErrorBanner } from '@/components/admin/ErrorBanner';
import { InfoTip } from '@/components/admin/InfoTip';
import { sendJson } from '@/lib/client/api';
import type { AudienceResponse } from '@/lib/email/journeys/api-types';
import {
  type JourneyDefinition,
  TRIGGER_TYPES,
  TRIGGERS,
  type Trigger,
} from '@/lib/email/journeys/schema';
import { Field, Section } from './Field';
import { buttonClass, compactInputClass, compactSelectClass } from './journeyUi';
import { ActionList, ConditionList, TagListInput } from './RuleLists';

const TIPS = {
  trigger:
    'What puts someone into this journey. A booking enrolls them the moment Momence reports it; an audience is checked every hour against your Momence customers; "added by hand" only enrolls people you add on the People tab.',
  firstBooking:
    "Only a customer's first-ever booking at Pyre enrolls them - use this for welcome and intro-offer journeys.",
  activePurchase:
    'Only customers holding an active membership or credit pack in Momence. Use it for credit-related journeys; it also makes the hourly check much faster.',
  inactiveDays: 'Last checked in at least this many days ago. Leave empty for "any time".',
  maxInactiveDays:
    'Last checked in no more than this many days ago. Keeps people who left long ago out, so switching the journey on does not email your whole history at once.',
  minVisits: 'Lifetime checked-in visits (not just bookings). Leave empty for "any".',
  withTags: 'Momence customer tags they must all have. Separate several with commas.',
  withoutTags:
    'Momence customer tags that keep someone out, e.g. "Google Review" for people who already reviewed. Separate several with commas.',
  enrollIf:
    'Extra requirements checked against live Momence data at the moment someone would enter. They must meet all of them.',
  exitIf:
    'Checked before every email. The moment any of these is true, they leave the journey and get nothing more from it.',
  reentry:
    'Whether someone can go through this journey more than once. Most journeys run once per person; re-engagement journeys can repeat after a waiting period.',
  cooldown: 'Counted from when their last run finished or they left it.',
  onEnd:
    'Momence tag changes made when someone finishes or leaves, for any reason - e.g. removing a discount tag so the discount ends with the journey.',
  completionTag:
    'Added in Momence only when someone reaches the end (not when they leave early), so staff can see who got the full journey.',
  campaign:
    "Links in this journey's emails are tagged with this campaign, so the visits, bookings and purchases they bring in show on that campaign in the Campaigns tool.",
  description:
    'Only staff see this. Say what the journey is for and anything to know before editing it.',
} as const;

function NumberInput({
  id,
  value,
  onChange,
  placeholder,
  min = 0,
}: {
  id?: string;
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  placeholder: string;
  min?: number;
}) {
  return (
    <input
      id={id}
      type="number"
      min={min}
      className={`${compactInputClass} w-full`}
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
    />
  );
}

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
  const ids = useId();

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
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <Section
        number={1}
        title="Who enters"
        description="What puts someone into this journey, and anything they must meet first."
      >
        <Field label="Starts when someone" tip={TIPS.trigger}>
          <div
            className="grid gap-2 sm:grid-cols-3"
            role="radiogroup"
            aria-label="Starts when someone"
          >
            {TRIGGER_TYPES.map((t) => (
              <label
                key={t}
                className={`cursor-pointer rounded border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--pyre-gold)]/60 ${
                  trigger.type === t
                    ? 'border-[var(--pyre-gold)]/70 bg-[var(--pyre-gold)]/10'
                    : 'border-white/10 bg-white/[0.02] hover:border-white/30'
                }`}
              >
                <input
                  type="radio"
                  className="sr-only"
                  name={`${ids}-trigger`}
                  checked={trigger.type === t}
                  onChange={() => setTriggerType(t)}
                />
                <span className="block text-sm font-medium text-[var(--pyre-creme)]">
                  {TRIGGERS[t].label}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-white/50">
                  {TRIGGERS[t].description}
                </span>
              </label>
            ))}
          </div>
        </Field>

        {trigger.type === 'session-booked' && (
          <label className="flex items-center gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              checked={trigger.firstBookingOnly}
              onChange={(e) => set({ trigger: { ...trigger, firstBookingOnly: e.target.checked } })}
            />
            Only their first-ever booking
            <InfoTip label="first-ever booking" text={TIPS.firstBooking} />
          </label>
        )}

        {trigger.type === 'sweep' && (
          <>
            <label className="flex items-center gap-2 text-sm text-white/80">
              <input
                type="checkbox"
                checked={trigger.withActivePurchase}
                onChange={(e) =>
                  set({ trigger: { ...trigger, withActivePurchase: e.target.checked } })
                }
              />
              Only people with an active membership or credit pack
              <InfoTip label="active membership or credit pack" text={TIPS.activePurchase} />
            </label>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label="Not seen for at least"
                tip={TIPS.inactiveDays}
                htmlFor={`${ids}-inactive`}
                hint="days"
              >
                <NumberInput
                  id={`${ids}-inactive`}
                  min={1}
                  value={trigger.inactiveDays}
                  placeholder="Any time"
                  onChange={(inactiveDays) => set({ trigger: { ...trigger, inactiveDays } })}
                />
              </Field>
              <Field
                label="...but seen within"
                tip={TIPS.maxInactiveDays}
                htmlFor={`${ids}-max`}
                hint="days"
              >
                <NumberInput
                  id={`${ids}-max`}
                  min={1}
                  value={trigger.maxInactiveDays}
                  placeholder="Any time"
                  onChange={(maxInactiveDays) => set({ trigger: { ...trigger, maxInactiveDays } })}
                />
              </Field>
              <Field
                label="Checked-in visits, at least"
                tip={TIPS.minVisits}
                htmlFor={`${ids}-visits`}
              >
                <NumberInput
                  id={`${ids}-visits`}
                  value={trigger.minVisits}
                  placeholder="Any"
                  onChange={(minVisits) => set({ trigger: { ...trigger, minVisits } })}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Has all of these tags" tip={TIPS.withTags}>
                <TagListInput
                  value={trigger.withTags}
                  onChange={(withTags) => set({ trigger: { ...trigger, withTags } })}
                  tags={tags}
                  placeholder="e.g. VIP, Founding member"
                />
              </Field>
              <Field label="Has none of these tags" tip={TIPS.withoutTags}>
                <TagListInput
                  value={trigger.withoutTags}
                  onChange={(withoutTags) => set({ trigger: { ...trigger, withoutTags } })}
                  tags={tags}
                  placeholder="e.g. Google Review"
                />
              </Field>
            </div>
          </>
        )}

        <Field
          label="Only enroll people who"
          tip={TIPS.enrollIf}
          hint="All of these must be true when they would enter."
        >
          <ConditionList
            conditions={definition.enrollIf}
            onChange={(enrollIf) => set({ enrollIf })}
            allowSession={sessionTrigger}
            tags={tags}
            emptyText="No extra requirements - everyone the trigger finds enters."
            addLabel="Add requirement"
          />
        </Field>

        {trigger.type === 'sweep' && (
          <AudienceEstimate journeyId={journeyId} definition={definition} />
        )}
      </Section>

      <Section
        number={2}
        title="When they leave early"
        description="Checked against live Momence data before every email."
      >
        <Field label="Take them out if" tip={TIPS.exitIf} hint="Any one of these is enough.">
          <ConditionList
            conditions={definition.exitIf}
            onChange={(exitIf) => set({ exitIf })}
            allowSession={sessionTrigger}
            tags={tags}
            emptyText="No exit rules - they stay until the last step."
            addLabel="Add exit rule"
          />
        </Field>
      </Section>

      <Section number={3} title="Going through it again">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Each person can go through it"
            tip={TIPS.reentry}
            htmlFor={`${ids}-reentry`}
          >
            <select
              id={`${ids}-reentry`}
              className={compactSelectClass}
              value={definition.reentry.mode}
              onChange={(e) =>
                set({
                  reentry:
                    e.target.value === 'once' ? { mode: 'once' } : { mode: 'cooldown', days: 90 },
                })
              }
            >
              <option value="once">Once, ever</option>
              <option value="cooldown">Again, after a waiting period</option>
            </select>
          </Field>
          {definition.reentry.mode === 'cooldown' && (
            <Field
              label="Waiting period"
              tip={TIPS.cooldown}
              htmlFor={`${ids}-cooldown`}
              hint="days after they finish or leave"
            >
              <NumberInput
                id={`${ids}-cooldown`}
                min={1}
                value={definition.reentry.days}
                placeholder="90"
                onChange={(days) =>
                  set({ reentry: { mode: 'cooldown', days: Math.max(1, days ?? 1) } })
                }
              />
            </Field>
          )}
        </div>
      </Section>

      <Section number={4} title="At the end">
        <Field label="When they finish or leave" tip={TIPS.onEnd}>
          <ActionList
            actions={definition.onEnd}
            onChange={(onEnd) => set({ onEnd })}
            tags={tags}
            emptyText="No tag changes."
          />
        </Field>
        <Field label="Tag people who finish" tip={TIPS.completionTag} htmlFor={`${ids}-completion`}>
          <input
            id={`${ids}-completion`}
            className={`${compactInputClass} w-full sm:w-80`}
            placeholder="Optional, e.g. Review Requested"
            value={definition.completionTag ?? ''}
            onChange={(e) => set({ completionTag: e.target.value || undefined })}
          />
        </Field>
      </Section>

      <CampaignSection
        journeyId={journeyId}
        journeyName={journeyName}
        value={definition.campaign}
        campaigns={campaigns}
        onChange={(campaign) => set({ campaign })}
      />

      <Section number={6} title="Notes">
        <Field
          label="What this journey is for"
          tip={TIPS.description}
          htmlFor={`${ids}-description`}
        >
          <textarea
            id={`${ids}-description`}
            rows={3}
            className={`${compactInputClass} w-full`}
            placeholder="e.g. Turns intro-offer customers into members before the intro expires."
            value={definition.description}
            onChange={(e) => set({ description: e.target.value })}
          />
        </Field>
      </Section>
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
    <Section number={5} title="Tracking">
      <Field label="Campaign" tip={TIPS.campaign}>
        <select
          className={`${compactSelectClass} sm:w-96`}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          aria-label="Campaign"
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
      </Field>
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
    </Section>
  );
}

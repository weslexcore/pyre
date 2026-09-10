// Creating or editing a campaign. The name is the one thing staff type that
// ends up in a URL: the slug preview under it shows exactly what utm_campaign
// every link will carry, and once the campaign exists that slug is locked.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { campaignErrorMessage } from '@/lib/campaigns/errors';
import { GOAL_METRICS, MAX_GOAL_TARGET, MAX_GOALS } from '@/lib/campaigns/goals';
import { newsletterDefaults } from '@/lib/campaigns/newsletter';
import { slugifyCampaign } from '@/lib/campaigns/slug';
import {
  type BlogPostRef,
  CAMPAIGN_TYPES,
  type CampaignGoal,
  type CampaignType,
  type EventOption,
  type UtmCampaign,
} from '@/lib/campaigns/types';
import { FIELD_LIMITS } from '@/lib/campaigns/validate';
import { invalidateJson } from '@/lib/client/cachedJson';
import {
  buttonClass,
  inputBaseClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  TileButton,
} from '../incidentUi';
import { SearchSelect } from '../SearchSelect';
import { SessionExpired, smallLabelClass } from './campaignUi';
import {
  DestinationPicker,
  type DestinationValue,
  eventLabel,
  useEvents,
} from './DestinationPicker';

interface CampaignFormProps {
  origin: string;
  blogPosts: BlogPostRef[];
  /** Editing an existing campaign renders inline on its detail page. */
  initial?: UtmCampaign;
  linkCount?: number;
  onSaved?: (campaign: UtmCampaign) => void;
  onCancel?: () => void;
}

/** "2026-09-14" from whatever date string the events feed carries, or ''. */
function ymdOf(date: string | undefined): string {
  if (!date) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const ms = Date.parse(date);
  if (Number.isNaN(ms)) return '';
  return new Date(ms).toISOString().slice(0, 10);
}

export function CampaignForm({
  origin,
  blogPosts,
  initial,
  linkCount = 0,
  onSaved,
  onCancel,
}: CampaignFormProps) {
  const editing = Boolean(initial);
  const events = useEvents();

  const [type, setType] = useState<CampaignType>(initial?.type ?? 'event');
  const [name, setName] = useState(initial?.name ?? '');
  const [destination, setDestination] = useState<DestinationValue>({
    kind: initial?.destinationKind || 'events',
    value: initial?.destinationValue ?? '',
  });
  const [startsAt, setStartsAt] = useState(initial?.startsAt ?? '');
  const [endsAt, setEndsAt] = useState(initial?.endsAt ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  // Targets are held as the raw strings the number inputs carry, so a
  // half-typed "1" never becomes a goal of 1 on its way to the server.
  const [targets, setTargets] = useState<Record<string, string>>(() =>
    Object.fromEntries((initial?.goals ?? []).map((goal) => [goal.metric, String(goal.target)]))
  );
  const [eventId, setEventId] = useState(
    initial?.destinationKind === 'event' ? initial.destinationValue : ''
  );
  // The name the event picker last filled in, so a later pick can replace it
  // without clobbering a name someone typed by hand.
  const [autoName, setAutoName] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (type === 'event') events.load();
  }, [type, events.load]);

  const slug = useMemo(() => slugifyCampaign(name), [name]);

  const goals = useMemo<CampaignGoal[]>(
    () =>
      GOAL_METRICS.map((metric) => ({
        metric: metric.key,
        target: Number.parseInt(targets[metric.key] ?? '', 10),
      })).filter((goal) => Number.isInteger(goal.target) && goal.target > 0),
    [targets]
  );
  const tooManyGoals = goals.length > MAX_GOALS;

  // Newsletter sends are one a month, named by month. Picking the type on a
  // fresh form fills the name, the month, and the home page as destination;
  // a name someone already typed is left alone.
  const pickType = useCallback(
    (next: CampaignType) => {
      setType(next);
      if (next !== 'newsletter' || editing) return;
      const defaults = newsletterDefaults(new Date());
      setName((current) =>
        current.trim() === '' || current === autoName ? defaults.name : current
      );
      setAutoName(defaults.name);
      setStartsAt((current) => current || defaults.startsAt);
      setEndsAt((current) => current || defaults.endsAt);
      setDestination({ kind: 'home', value: '' });
    },
    [autoName, editing]
  );

  const pickEvent = useCallback(
    (event: EventOption | undefined) => {
      setEventId(event?.id ?? '');
      if (!event) return;
      setDestination({ kind: 'event', value: event.id });
      setName((current) => (current.trim() === '' || current === autoName ? event.title : current));
      setAutoName(event.title);
      const ymd = ymdOf(event.date);
      if (ymd) setEndsAt((current) => current || ymd);
    },
    [autoName]
  );

  const submit = useCallback(async () => {
    setSaving(true);
    setError(null);
    setExisting(null);
    const body = {
      name,
      type,
      destination: destination,
      startsAt,
      endsAt,
      notes,
      goals,
    };
    try {
      const res = await fetch(
        editing ? `/api/admin/campaigns/${initial?.id}` : '/api/admin/campaigns',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      const json = (await res.json().catch(() => ({}))) as {
        campaign?: UtmCampaign;
        error?: string;
        existing?: { id: string; name: string };
      };
      if (res.status === 409 && json.existing) {
        setExisting(json.existing);
        return;
      }
      if (!res.ok || !json.campaign) {
        setError(campaignErrorMessage(json.error, `Could not save (${res.status})`));
        return;
      }
      invalidateJson('/api/admin/campaigns');
      if (editing) {
        onSaved?.(json.campaign);
      } else {
        window.location.assign(`/admin/campaigns/${json.campaign.id}`);
      }
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  }, [name, type, destination, startsAt, endsAt, notes, goals, editing, initial?.id, onSaved]);

  if (events.sessionExpired) {
    return (
      <SessionExpired
        returnTo={editing ? `/admin/campaigns/${initial?.id}` : '/admin/campaigns/new'}
      />
    );
  }

  return (
    <form
      className="space-y-6 max-w-3xl"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {!editing && (
        <a href="/admin/campaigns" className={`${buttonClass} inline-block`}>
          <span aria-hidden="true">&larr;</span> All campaigns
        </a>
      )}

      <section>
        <span className={labelClass}>What kind of campaign</span>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {CAMPAIGN_TYPES.map((option) => (
            <TileButton
              key={option.key}
              selected={type === option.key}
              label={option.label}
              hint={option.hint}
              onClick={() => pickType(option.key)}
            />
          ))}
        </div>
      </section>

      {type === 'event' && !editing && (
        <section>
          <label htmlFor="campaign-event" className={labelClass}>
            Which event
          </label>
          {events.loading && <p className="font-mono text-xs text-white/40">Loading events…</p>}
          {events.error && (
            <p className="text-xs text-[var(--pyre-red)]">
              {events.error}{' '}
              <button type="button" className="underline" onClick={events.load}>
                Try again
              </button>
            </p>
          )}
          {events.items && (
            <SearchSelect
              id="campaign-event"
              options={events.items.map((event) => ({
                value: event.id,
                label: eventLabel(event),
              }))}
              value={eventId}
              onChange={(id) => pickEvent(events.items?.find((ev) => ev.id === id))}
              placeholder="Type to find an event; it fills in the name and link"
              emptyText="No upcoming event matches"
            />
          )}
        </section>
      )}

      <section>
        <label htmlFor="campaign-name" className={labelClass}>
          Name
        </label>
        <input
          id="campaign-name"
          className={inputClass}
          value={name}
          maxLength={FIELD_LIMITS.name}
          placeholder={
            type === 'event'
              ? 'Rest Fest 2026'
              : type === 'sale'
                ? 'Winter intro offer'
                : 'Summer launch'
          }
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
        />
        <p className="mt-1.5 font-mono text-xs break-all">
          <span className="text-white/35">utm_campaign = </span>
          <span className="text-[var(--pyre-creme)]">{editing ? initial?.slug : slug || '…'}</span>
          {editing && (
            <span className="text-white/35">
              {' '}
              (locked
              {linkCount > 0 ? `, used in ${linkCount} link${linkCount === 1 ? '' : 's'}` : ''})
            </span>
          )}
        </p>
        {!editing && (
          <p className="mt-1 text-xs text-white/40">
            Lowercase with dashes, made from the name. Only put a year in if the campaign is a
            one-off. It cannot change once the campaign exists.
          </p>
        )}
      </section>

      <section>
        <span className={labelClass}>Where the links go</span>
        <DestinationPicker
          origin={origin}
          blogPosts={blogPosts}
          events={events}
          value={destination}
          onChange={(next) => {
            setDestination(next);
            if (next.kind === 'event') setEventId(next.value);
          }}
        />
      </section>

      <section className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="campaign-start" className={smallLabelClass}>
            Starts (optional)
          </label>
          <input
            id="campaign-start"
            type="date"
            className={inputClass}
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="campaign-end" className={smallLabelClass}>
            Ends (optional)
          </label>
          <input
            id="campaign-end"
            type="date"
            className={inputClass}
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
          />
        </div>
      </section>

      <section>
        <span className={labelClass}>Goals (optional)</span>
        <p className="-mt-1 mb-2 text-xs text-white/40">
          What this campaign is meant to produce. Fill in the ones that matter and leave the rest
          empty; the campaign page reads each one against the report while it runs, against the pace
          its dates imply.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {GOAL_METRICS.map((metric) => (
            <label
              key={metric.key}
              className="flex items-center gap-3 rounded border border-white/10 bg-white/5 px-3 py-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm leading-snug text-[var(--pyre-creme)]">
                  {metric.label}
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-balance text-white/40">
                  {metric.hint}
                </span>
              </span>
              <input
                type="number"
                min={1}
                max={MAX_GOAL_TARGET}
                inputMode="numeric"
                aria-label={`${metric.label} target`}
                placeholder="—"
                className={`${inputBaseClass} w-24 shrink-0 !py-2 text-right tabular-nums placeholder-white/20 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
                value={targets[metric.key] ?? ''}
                onChange={(e) => setTargets((prev) => ({ ...prev, [metric.key]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        {tooManyGoals && (
          <p className="mt-2 text-xs text-[var(--pyre-gold)]">
            Pick at most {MAX_GOALS} goals. A campaign that is chasing everything is not being
            measured against anything.
          </p>
        )}
      </section>

      <section>
        <label htmlFor="campaign-notes" className={smallLabelClass}>
          Notes (optional)
        </label>
        <textarea
          id="campaign-notes"
          className={`${inputClass} min-h-20`}
          value={notes}
          maxLength={FIELD_LIMITS.notes}
          placeholder="What the offer is, who it is for, anything the next person should know."
          onChange={(e) => setNotes(e.target.value)}
        />
      </section>

      {existing && (
        <div className="rounded border border-[var(--pyre-gold)]/40 bg-[var(--pyre-gold)]/10 p-3 text-sm text-[var(--pyre-gold)]">
          A campaign with this name already exists.{' '}
          <a href={`/admin/campaigns/${existing.id}`} className="underline">
            Open {existing.name}
          </a>{' '}
          and generate links there, or pick a different name.
        </div>
      )}
      {error && <p className="text-sm text-[var(--pyre-red)]">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={saving || !slug || tooManyGoals}
          className={primaryButtonClass}
        >
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Create campaign'}
        </button>
        {editing ? (
          <button type="button" onClick={onCancel} className={buttonClass}>
            Cancel
          </button>
        ) : (
          <a href="/admin/campaigns" className={buttonClass}>
            Cancel
          </a>
        )}
      </div>
    </form>
  );
}

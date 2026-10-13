// /admin/journeys: every email journey with its switch, what starts it, how
// many people are in it, and how its last 30 days of email did. New journeys
// start here (blank or copied) and open in the editor, switched off and in
// test mode.

import { useState } from 'react';
import { ErrorBanner } from '@/components/admin/ErrorBanner';
import { InfoTip } from '@/components/admin/InfoTip';
import { Modal, modalPanelClass } from '@/components/admin/Modal';
import { Toggle } from '@/components/admin/Toggle';
import { ApiError, sendJson } from '@/lib/client/api';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import { timeAgo } from '@/lib/client/format';
import type { JourneyListResponse, JourneySummaryDto } from '@/lib/email/journeys/api-types';
import {
  JOURNEY_ID_RE,
  TRIGGER_TYPES,
  TRIGGERS,
  type TriggerType,
} from '@/lib/email/journeys/schema';
import {
  badgeClass,
  blankDefinition,
  buttonClass,
  cardClass,
  describeTrigger,
  goldButtonClass,
  inputClass,
  mergeVisibleOrder,
  pct,
  pillClass,
  sectionHeading,
  selectClass,
  slugify,
} from './journeyUi';
import { DragHandle, SortableList } from './Sortable';

const LIST_URL = '/api/admin/journeys';

type StatusFilter = 'all' | 'on' | 'off' | 'archived';

const FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'All',
  on: 'On',
  off: 'Off',
  archived: 'Archived',
};

function matchesFilter(j: JourneySummaryDto, filter: StatusFilter): boolean {
  if (filter === 'archived') return j.archived;
  if (j.archived) return false;
  if (filter === 'on') return j.enabled;
  if (filter === 'off') return !j.enabled;
  return true;
}

function matchesSearch(j: JourneySummaryDto, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [j.name, j.id, j.definition?.description ?? ''].some((text) =>
    text.toLowerCase().includes(q)
  );
}

export function JourneysIndex() {
  const { data, error, reload, setData } = useCachedJson<JourneyListResponse>(LIST_URL);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ duplicateFrom?: JourneySummaryDto } | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [orderError, setOrderError] = useState<string | null>(null);

  const toggle = async (journey: JourneySummaryDto, enabled: boolean) => {
    setBusy(journey.id);
    setActionError(null);
    try {
      await sendJson(`/api/admin/journeys/${journey.id}`, 'PATCH', { enabled });
      invalidateJson('/api/admin/journeys');
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const all = data?.journeys ?? [];
  const counts = {
    all: all.filter((j) => !j.archived).length,
    on: all.filter((j) => !j.archived && j.enabled).length,
    off: all.filter((j) => !j.archived && !j.enabled).length,
    archived: all.filter((j) => j.archived).length,
  };
  const journeys = all.filter((j) => matchesFilter(j, filter) && matchesSearch(j, query));

  // Drag within whatever is showing; hidden journeys keep their places.
  const reorder = async (visible: JourneySummaryDto[]) => {
    if (!data) return;
    const ids = mergeVisibleOrder(
      all.map((j) => j.id),
      journeys.map((j) => j.id),
      visible.map((j) => j.id)
    );
    const byId = new Map(all.map((j) => [j.id, j]));
    setData({ ...data, journeys: ids.map((id) => byId.get(id) as JourneySummaryDto) });
    setOrderError(null);
    try {
      await sendJson('/api/admin/journeys/order', 'POST', { ids });
      invalidateJson('/api/admin/journeys');
    } catch (e) {
      setOrderError(`The new order wasn't saved: ${e instanceof Error ? e.message : String(e)}`);
      await reload();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-white/60">
          Each journey enrolls people when something happens (a booking, or matching an audience),
          then sends its emails on a schedule, re-checking Momence before every one. Off pauses a
          journey: nobody new enters and people already in it wait where they are.
        </p>
        <button type="button" className={goldButtonClass} onClick={() => setCreating({})}>
          New journey
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          className={`${inputClass} min-w-0 flex-1 sm:max-w-sm`}
          placeholder="Search journeys by name or what they do"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search journeys"
        />
        <fieldset className="flex flex-wrap gap-1.5">
          <legend className="sr-only">Show</legend>
          {(['all', 'on', 'off', 'archived'] as StatusFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={pillClass(filter === f)}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {FILTER_LABELS[f]} {counts[f]}
            </button>
          ))}
        </fieldset>
      </div>

      {data && !data.journeyTemplateLive && (
        <ErrorBanner>
          The shared <span className="font-mono">journey</span> email template is not live, so
          dashboard-built emails only reach whitelisted addresses. Switch it on in{' '}
          <a href="/admin/email-templates" className="underline">
            Email Templates
          </a>{' '}
          when you are ready to send to customers.
        </ErrorBanner>
      )}
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {actionError && <ErrorBanner>{actionError}</ErrorBanner>}
      {orderError && <ErrorBanner>{orderError}</ErrorBanner>}

      {!data && !error && <p className="text-sm text-white/40">Loading journeys...</p>}

      {data && journeys.length === 0 && (
        <p className="rounded border border-dashed border-white/15 p-6 text-center text-sm text-white/50">
          {query.trim() || filter !== 'all'
            ? 'No journeys match. Try another search or filter.'
            : 'No journeys yet. Create the first one.'}
        </p>
      )}

      <SortableList
        items={journeys}
        getId={(j) => j.id}
        getLabel={(j) => j.name}
        onReorder={(next) => void reorder(next)}
        className="flex flex-col gap-2"
      >
        {(journey, _i, drag) => {
          const s = journey.stats;
          const steps = journey.definition?.steps.filter((st) => !st.archived).length ?? 0;
          return (
            <div
              className={`${cardClass} flex flex-col gap-3 sm:flex-row sm:items-center ${drag.isDragging ? 'bg-[var(--pyre-black)]' : ''}`}
            >
              <div className="self-start sm:self-center">
                <DragHandle drag={drag} label={journey.name} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={`/admin/journeys/${journey.id}`}
                    className="text-base font-semibold text-[var(--pyre-creme)] hover:underline"
                  >
                    {journey.name}
                  </a>
                  {journey.archived ? (
                    <span className={badgeClass('off')}>archived</span>
                  ) : journey.enabled ? (
                    <span className={badgeClass('on')}>on</span>
                  ) : (
                    <span className={badgeClass('off')}>off</span>
                  )}
                  {journey.testMode && !journey.archived && (
                    <span
                      className={badgeClass('test')}
                      title="Only whitelisted addresses enroll or receive"
                    >
                      test mode
                    </span>
                  )}
                  {journey.definitionError && <span className={badgeClass('warn')}>invalid</span>}
                </div>
                <p className="mt-1 text-xs text-white/50">
                  {journey.definition
                    ? describeTrigger(journey.definition.trigger)
                    : journey.definitionError}
                  {' · '}
                  {steps} {steps === 1 ? 'step' : 'steps'}
                  {' · '}
                  edited {timeAgo(journey.updatedAt)}
                  {journey.updatedBy ? ` by ${journey.updatedBy}` : ''}
                </p>
              </div>

              <dl className="grid grid-cols-4 gap-x-4 gap-y-1 font-mono text-[11px] text-white/50 sm:text-right">
                <div>
                  <dt className="uppercase tracking-wide text-white/30">In it</dt>
                  <dd className="text-sm text-[var(--pyre-creme)]">{s.active}</dd>
                </div>
                <div>
                  <dt className="uppercase tracking-wide text-white/30">Done</dt>
                  <dd className="text-sm">{s.completed + s.exited}</dd>
                </div>
                <div>
                  <dt className="uppercase tracking-wide text-white/30">Sent 30d</dt>
                  <dd className="text-sm">{s.sent30d}</dd>
                </div>
                <div
                  title={`Opened ${pct(s.opened30d, s.sent30d)} (opens are inflated by Apple Mail)`}
                >
                  <dt className="uppercase tracking-wide text-white/30">Clicked</dt>
                  <dd className="text-sm">{pct(s.clicked30d, s.sent30d)}</dd>
                </div>
              </dl>

              <div className="flex items-center gap-2">
                {!journey.archived && (
                  <Toggle
                    checked={journey.enabled}
                    disabled={busy !== null || !!journey.definitionError}
                    label={journey.enabled ? `Pause ${journey.name}` : `Turn on ${journey.name}`}
                    onChange={(next) => void toggle(journey, next)}
                  />
                )}
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => setCreating({ duplicateFrom: journey })}
                  disabled={!journey.definition}
                >
                  Copy
                </button>
              </div>
            </div>
          );
        }}
      </SortableList>
      {journeys.length > 1 && (
        <p className="text-xs text-white/40">
          Drag a journey by its handle to change the order. Everyone sees the same order.
        </p>
      )}

      {creating && (
        <NewJourneyDialog
          duplicateFrom={creating.duplicateFrom}
          existingIds={new Set((data?.journeys ?? []).map((j) => j.id))}
          onClose={() => setCreating(null)}
        />
      )}
    </div>
  );
}

function NewJourneyDialog({
  duplicateFrom,
  existingIds,
  onClose,
}: {
  duplicateFrom?: JourneySummaryDto;
  existingIds: Set<string>;
  onClose: () => void;
}) {
  const [name, setName] = useState(duplicateFrom ? `${duplicateFrom.name} (copy)` : '');
  const [id, setId] = useState(duplicateFrom ? slugify(`${duplicateFrom.id}-copy`) : '');
  const [idTouched, setIdTouched] = useState(false);
  const [trigger, setTrigger] = useState<TriggerType>('session-booked');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveId = idTouched ? id : slugify(name) || id;
  const idProblem = !effectiveId
    ? null
    : !JOURNEY_ID_RE.test(effectiveId)
      ? 'Use 2-48 lowercase letters, numbers and dashes'
      : existingIds.has(effectiveId)
        ? 'Already taken'
        : null;

  const create = async () => {
    setSaving(true);
    setError(null);
    try {
      await sendJson('/api/admin/journeys', 'POST', {
        id: effectiveId,
        name,
        ...(duplicateFrom
          ? { duplicateFrom: duplicateFrom.id }
          : { definition: blankDefinition(trigger) }),
      });
      invalidateJson('/api/admin/journeys');
      window.location.href = `/admin/journeys/${effectiveId}`;
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <Modal
      labelledBy="new-journey-title"
      onClose={onClose}
      panelClassName={`${modalPanelClass} max-w-lg p-5`}
    >
      <h2 id="new-journey-title" className={sectionHeading}>
        {duplicateFrom ? `Copy ${duplicateFrom.name}` : 'New journey'}
      </h2>
      <div className="mt-4 flex flex-col gap-4">
        <label>
          <span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-[var(--pyre-creme)]">
            Name
            <InfoTip
              label="the name"
              text="What staff see in the list. You can rename it any time."
            />
          </span>
          <input
            className={`${inputClass} w-full`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Lapsed members"
            // biome-ignore lint/a11y/noAutofocus: the dialog's only first field
            autoFocus
          />
        </label>
        <label>
          <span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-[var(--pyre-creme)]">
            Id (permanent)
            <InfoTip
              label="the id"
              text="A short code filled in from the name. It appears in the journey's address and its tracking, so it can never change after you create the journey."
            />
          </span>
          <input
            className={`${inputClass} w-full font-mono`}
            value={effectiveId}
            onChange={(e) => {
              setIdTouched(true);
              setId(e.target.value.toLowerCase());
            }}
          />
          <span className="mt-1 block text-xs text-white/40">
            {idProblem ?? 'Used in email tracking links and send history; it can never change.'}
          </span>
        </label>
        {!duplicateFrom && (
          <label>
            <span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-[var(--pyre-creme)]">
              Starts when someone
              <InfoTip
                label="what starts it"
                text="What puts people into the journey. You can change this later on the Settings tab."
              />
            </span>
            <select
              className={`${selectClass} w-full`}
              value={trigger}
              onChange={(e) => setTrigger(e.target.value as TriggerType)}
            >
              {TRIGGER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TRIGGERS[t].label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-white/40">
              {TRIGGERS[trigger].description}
            </span>
          </label>
        )}
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <p className="text-xs text-white/40">
          It starts switched off and in test mode, so you can build and try it before anyone gets an
          email.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonClass} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={goldButtonClass}
            onClick={() => void create()}
            disabled={saving || !name.trim() || !effectiveId || !!idProblem}
          >
            {saving ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

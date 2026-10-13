// /admin/journeys: every email journey with its switch, what starts it, how
// many people are in it, and how its last 30 days of email did. New journeys
// start here (blank or copied) and open in the editor, switched off and in
// test mode.

import { useState } from 'react';
import { ErrorBanner } from '@/components/admin/ErrorBanner';
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
  labelClass,
  pct,
  sectionHeading,
  selectClass,
  slugify,
} from './journeyUi';

const LIST_URL = '/api/admin/journeys';

export function JourneysIndex() {
  const { data, error, reload } = useCachedJson<JourneyListResponse>(LIST_URL);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ duplicateFrom?: JourneySummaryDto } | null>(null);
  const [showArchived, setShowArchived] = useState(false);

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

  const journeys = (data?.journeys ?? []).filter((j) => showArchived || !j.archived);
  const archivedCount = (data?.journeys ?? []).filter((j) => j.archived).length;

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

      {!data && !error && <p className="text-sm text-white/40">Loading journeys...</p>}

      <ul className="flex flex-col gap-2">
        {journeys.map((journey) => {
          const s = journey.stats;
          const steps = journey.definition?.steps.filter((st) => !st.archived).length ?? 0;
          return (
            <li
              key={journey.id}
              className={`${cardClass} flex flex-col gap-3 sm:flex-row sm:items-center`}
            >
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
            </li>
          );
        })}
      </ul>

      {archivedCount > 0 && (
        <button
          type="button"
          className="self-start font-mono text-xs uppercase tracking-wide text-white/40 hover:text-white/70"
          onClick={() => setShowArchived((v) => !v)}
        >
          {showArchived ? 'Hide' : 'Show'} {archivedCount} archived
        </button>
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
          <span className={labelClass}>Name</span>
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
          <span className={labelClass}>Id (permanent)</span>
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
            <span className={labelClass}>Starts when someone</span>
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

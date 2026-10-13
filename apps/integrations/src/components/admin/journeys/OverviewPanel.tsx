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
  definition,
  onChange,
  tags,
}: {
  journeyId: string;
  definition: JourneyDefinition;
  onChange: (next: JourneyDefinition) => void;
  tags: string[];
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
          ? { type, withTags: [], withoutTags: [] }
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
        <p className="text-xs text-white/60">
          {result.matched} of the first {result.scanned} candidates match
          {result.partial ? ` (out of about ${result.totalCandidates} - an estimate)` : ''}.
          {result.sample.length > 0 && (
            <span className="block text-white/40">e.g. {result.sample.join(', ')}</span>
          )}
        </p>
      )}
    </div>
  );
}

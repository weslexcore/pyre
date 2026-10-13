// The Steps tab: the journey's timeline on the left, the selected step's
// timing / conditions / actions / email on the right, and a live preview of
// that email (sample data, or a real customer's) with a test send.

import { useEffect, useRef, useState } from 'react';
import { ErrorBanner } from '@/components/admin/ErrorBanner';
import { ApiError, sendJson } from '@/lib/client/api';
import type { PreviewResponse } from '@/lib/email/journeys/api-types';
import {
  ANCHORS,
  type BlockContent,
  describeCondition,
  describeTiming,
  type JourneyDefinition,
  type JourneyStep,
  journeyCampaign,
  type StepContent,
  type StepTiming,
  TEMPLATE_STEP_KEYS,
  TIMING_ANCHORS,
  type TimingAnchor,
} from '@/lib/email/journeys/schema';
import { BlockEditor } from './BlockEditor';
import { CustomerPicker, type PickedCustomer } from './CustomerPicker';
import {
  badgeClass,
  buttonClass,
  compactInputClass,
  compactSelectClass,
  labelClass,
  microLabelClass,
  newStep,
  sectionHeading,
} from './journeyUi';
import { ActionList, ConditionList } from './RuleLists';

export function StepsPanel({
  journeyId,
  definition,
  savedStepKeys,
  onChange,
  tags,
  viewerEmail,
}: {
  journeyId: string;
  definition: JourneyDefinition;
  /** Keys in the last saved revision — those steps can only be archived. */
  savedStepKeys: Set<string>;
  onChange: (next: JourneyDefinition) => void;
  tags: string[];
  viewerEmail: string;
}) {
  const steps = definition.steps;
  const [selected, setSelected] = useState<string | null>(steps[0]?.key ?? null);
  const current = steps.find((s) => s.key === selected) ?? steps[0] ?? null;
  const sessionTrigger = definition.trigger.type === 'session-booked';

  const setSteps = (next: JourneyStep[]) => onChange({ ...definition, steps: next });
  const updateStep = (key: string, patch: Partial<JourneyStep>) =>
    setSteps(steps.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    setSteps(next);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <div className="flex flex-col gap-2">
        <p className={sectionHeading}>Timeline</p>
        <ol className="flex flex-col gap-1.5">
          {steps.map((step, i) => (
            <li key={step.key}>
              <button
                type="button"
                onClick={() => setSelected(step.key)}
                className={`w-full rounded border px-3 py-2 text-left transition-colors ${
                  current?.key === step.key
                    ? 'border-[var(--pyre-gold)]/60 bg-[var(--pyre-gold)]/10'
                    : 'border-white/10 bg-white/[0.03] hover:border-white/30'
                } ${step.archived ? 'opacity-50' : ''}`}
              >
                <span className="block font-mono text-[10px] uppercase tracking-wide text-white/40">
                  {i + 1}. {describeTiming(step.timing, sessionTrigger)}
                </span>
                <span className="mt-0.5 block truncate text-sm text-[var(--pyre-creme)]">
                  {step.name || step.key}
                </span>
                <span className="mt-0.5 block truncate text-xs text-white/40">
                  {step.archived
                    ? 'Archived - skipped'
                    : step.content.type === 'blocks'
                      ? step.content.subject
                      : step.content.type === 'template'
                        ? `Coded template: ${step.content.key}`
                        : 'No email - actions only'}
                </span>
                {step.skipIf.length > 0 && !step.archived && (
                  <span className="mt-0.5 block truncate text-[11px] text-white/40">
                    Skipped if {step.skipIf.map(describeCondition).join(' or ').toLowerCase()}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className={`${buttonClass} self-start`}
          onClick={() => {
            const step = newStep(steps);
            setSteps([...steps, step]);
            setSelected(step.key);
          }}
        >
          Add step
        </button>
      </div>

      {current ? (
        <StepEditor
          key={current.key}
          journeyId={journeyId}
          campaign={journeyCampaign(journeyId, definition)}
          step={current}
          index={steps.indexOf(current)}
          count={steps.length}
          saved={savedStepKeys.has(current.key)}
          sessionTrigger={sessionTrigger}
          tags={tags}
          viewerEmail={viewerEmail}
          onChange={(patch) => updateStep(current.key, patch)}
          onMove={(delta) => move(steps.indexOf(current), delta)}
          onDelete={() => {
            setSteps(steps.filter((s) => s.key !== current.key));
            setSelected(null);
          }}
        />
      ) : (
        <p className="text-sm text-white/40">No steps yet. Add one to start.</p>
      )}
    </div>
  );
}

// --- One step ---

const UNITS = { hours: 1, days: 24 } as const;
type Unit = keyof typeof UNITS;

function splitOffset(hours: number): { amount: number; unit: Unit; before: boolean } {
  const abs = Math.abs(hours);
  const unit: Unit = abs !== 0 && abs % 24 === 0 ? 'days' : 'hours';
  return { amount: abs / UNITS[unit], unit, before: hours < 0 };
}

function TimingEditor({
  timing,
  onChange,
  sessionTrigger,
}: {
  timing: StepTiming;
  onChange: (t: StepTiming) => void;
  sessionTrigger: boolean;
}) {
  const { amount, unit, before } = splitOffset(timing.offsetHours);
  const set = (next: { amount?: number; unit?: Unit; before?: boolean; anchor?: TimingAnchor }) => {
    const a = next.amount ?? amount;
    const u = next.unit ?? unit;
    const anchor = next.anchor ?? timing.anchor;
    // Only intro expiry can be counted backwards from.
    const b = anchor === 'intro-expiry' ? (next.before ?? before) : false;
    onChange({ anchor, offsetHours: (b ? -1 : 1) * a * UNITS[u] });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input
        type="number"
        min={0}
        step="any"
        className={`${compactInputClass} w-20`}
        value={amount}
        onChange={(e) => set({ amount: Math.max(0, Number(e.target.value) || 0) })}
      />
      <select
        className={compactSelectClass}
        value={unit}
        onChange={(e) => set({ unit: e.target.value as Unit })}
      >
        <option value="hours">hours</option>
        <option value="days">days</option>
      </select>
      {timing.anchor === 'intro-expiry' ? (
        <select
          className={compactSelectClass}
          value={before ? 'before' : 'after'}
          onChange={(e) => set({ before: e.target.value === 'before' })}
        >
          <option value="before">before</option>
          <option value="after">after</option>
        </select>
      ) : (
        <span className="text-sm text-white/60">after</span>
      )}
      <select
        className={compactSelectClass}
        value={timing.anchor}
        onChange={(e) => set({ anchor: e.target.value as TimingAnchor })}
      >
        {TIMING_ANCHORS.map((a) => (
          <option key={a} value={a}>
            {a === 'trigger' && sessionTrigger
              ? 'the session ends'
              : ANCHORS[a].label.toLowerCase()}
          </option>
        ))}
      </select>
      <p className="w-full text-xs text-white/40">
        {timing.anchor === 'trigger' && sessionTrigger
          ? 'Counted from when the booked session ends.'
          : ANCHORS[timing.anchor].description}{' '}
        Emails only go out 9am-8pm Eastern; anything due overnight waits for the morning.
      </p>
    </div>
  );
}

function StepEditor({
  journeyId,
  campaign,
  step,
  index,
  count,
  saved,
  sessionTrigger,
  tags,
  viewerEmail,
  onChange,
  onMove,
  onDelete,
}: {
  journeyId: string;
  campaign: string;
  step: JourneyStep;
  index: number;
  count: number;
  saved: boolean;
  sessionTrigger: boolean;
  tags: string[];
  viewerEmail: string;
  onChange: (patch: Partial<JourneyStep>) => void;
  onMove: (delta: number) => void;
  onDelete: () => void;
}) {
  const setContentType = (type: StepContent['type']) => {
    if (type === step.content.type) return;
    if (type === 'blocks') {
      onChange({ content: newStep([]).content });
    } else if (type === 'template') {
      onChange({ content: { type: 'template', key: TEMPLATE_STEP_KEYS[0] } });
    } else {
      onChange({ content: { type: 'none' } });
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className={labelClass}>Step name</span>
          <input
            className={`${compactInputClass} w-full`}
            value={step.name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </label>
        <span
          className="pb-2 font-mono text-[11px] text-white/30"
          title="Permanent; part of the send history"
        >
          {step.key}
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            className={buttonClass}
            onClick={() => onMove(-1)}
            disabled={index === 0}
          >
            Earlier
          </button>
          <button
            type="button"
            className={buttonClass}
            onClick={() => onMove(1)}
            disabled={index === count - 1}
          >
            Later
          </button>
          {saved ? (
            <button
              type="button"
              className={buttonClass}
              onClick={() => onChange({ archived: !step.archived })}
            >
              {step.archived ? 'Restore' : 'Archive'}
            </button>
          ) : (
            <button type="button" className={buttonClass} onClick={onDelete}>
              Delete
            </button>
          )}
        </div>
      </div>
      {step.archived && (
        <p className={badgeClass('off')}>
          Archived: everyone skips this step. Restore it to send it again.
        </p>
      )}

      <section>
        <p className={labelClass}>When</p>
        <TimingEditor
          timing={step.timing}
          onChange={(timing) => onChange({ timing })}
          sessionTrigger={sessionTrigger}
        />
      </section>

      <section>
        <p className={labelClass}>Skip this step if any of these are true</p>
        <ConditionList
          conditions={step.skipIf}
          onChange={(skipIf) => onChange({ skipIf })}
          allowSession={sessionTrigger}
          tags={tags}
          emptyText="Never skipped."
        />
      </section>

      <section>
        <p className={labelClass}>Before sending</p>
        <ActionList
          actions={step.actions}
          onChange={(actions) => onChange({ actions })}
          tags={tags}
          emptyText="No tag changes. (Add a tag here to switch on a Momence Price Rule discount.)"
        />
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className={labelClass}>Email</p>
          <select
            className={compactSelectClass}
            value={step.content.type}
            onChange={(e) => setContentType(e.target.value as StepContent['type'])}
          >
            <option value="blocks">Write an email</option>
            <option value="template">Coded template</option>
            <option value="none">No email (wait, then run actions)</option>
          </select>
        </div>

        {step.content.type === 'none' && (
          <p className="text-xs text-white/40">
            This step sends nothing: it waits for its time, then runs its tag actions (for example,
            to end a discount window).
          </p>
        )}

        {step.content.type === 'template' && (
          <label>
            <span className={microLabelClass}>Template</span>
            <select
              className={`${compactSelectClass} mt-1`}
              value={step.content.key}
              onChange={(e) => onChange({ content: { type: 'template', key: e.target.value } })}
            >
              {TEMPLATE_STEP_KEYS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-white/40">
              A coded email from the original journeys; its copy can only change in code. Switch to
              "Write an email" to edit it here.
            </span>
          </label>
        )}

        {step.content.type !== 'none' && (
          <div className="grid gap-4 xl:grid-cols-2">
            {step.content.type === 'blocks' && (
              <BlockEditor
                content={step.content}
                onChange={(content: BlockContent) => onChange({ content })}
                campaign={campaign}
                stepKey={step.key}
              />
            )}
            <EmailPreview
              journeyId={journeyId}
              campaign={campaign}
              stepKey={step.key}
              content={step.content}
              viewerEmail={viewerEmail}
            />
          </div>
        )}
      </section>
    </div>
  );
}

// --- Preview ---

function EmailPreview({
  journeyId,
  campaign,
  stepKey,
  content,
  viewerEmail,
}: {
  journeyId: string;
  campaign: string;
  stepKey: string;
  content: StepContent;
  viewerEmail: string;
}) {
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testTo, setTestTo] = useState(viewerEmail);
  const [testState, setTestState] = useState<string | null>(null);
  const seq = useRef(0);
  const contentJson = JSON.stringify(content);

  useEffect(() => {
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const result = await sendJson<PreviewResponse>(
          `/api/admin/journeys/${journeyId}/preview`,
          'POST',
          {
            content: JSON.parse(contentJson),
            stepKey,
            campaign,
            memberId: customer?.memberId,
          }
        );
        if (mine !== seq.current) return;
        setPreview(result);
        setError(null);
      } catch (e) {
        if (mine !== seq.current) return;
        setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [journeyId, campaign, stepKey, contentJson, customer?.memberId]);

  const sendTest = async () => {
    setTestState('Sending...');
    try {
      const result = await sendJson<{ to: string; missing: string[] }>(
        `/api/admin/journeys/${journeyId}/test-send`,
        'POST',
        { content, to: testTo, stepKey, campaign, memberId: customer?.memberId }
      );
      setTestState(
        `Sent to ${result.to}${result.missing.length ? ` (missing: ${result.missing.join(', ')})` : ''}`
      );
    } catch (e) {
      setTestState(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <CustomerPicker selected={customer} onSelect={setCustomer} />
      {error && <ErrorBanner mono>{error}</ErrorBanner>}
      {preview && (
        <>
          <p className="truncate text-sm">
            <span className="font-mono text-[10px] uppercase tracking-wide text-white/40">
              Subject{' '}
            </span>
            {preview.subject}
          </p>
          {preview.missing.length > 0 && (
            <ErrorBanner mono>
              No value for {preview.missing.map((m) => `{{${m}}}`).join(', ')}
              {customer ? ' for this customer' : ''} - this step would be skipped for them. Add a
              fallback ({'{{field|text}}'}) to send anyway.
            </ErrorBanner>
          )}
          <iframe
            title="Email preview"
            srcDoc={preview.html}
            sandbox=""
            className="h-[640px] w-full rounded border border-white/10 bg-white"
          />
        </>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          className={`${compactInputClass} min-w-0 flex-1`}
          value={testTo}
          onChange={(e) => setTestTo(e.target.value)}
          aria-label="Send a test to"
        />
        <button type="button" className={buttonClass} onClick={() => void sendTest()}>
          Send test
        </button>
      </div>
      {testState && <p className="font-mono text-xs text-white/50">{testState}</p>}
    </div>
  );
}

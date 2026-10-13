// The Steps tab: the journey's timeline on the left (drag to reorder), the
// selected step's timing / conditions / actions / email on the right, and a
// live preview of that email (sample data, or a real customer's) with a test
// send.

import { useEffect, useId, useRef, useState } from 'react';
import { ErrorBanner } from '@/components/admin/ErrorBanner';
import { InfoTip } from '@/components/admin/InfoTip';
import { ApiError, sendJson } from '@/lib/client/api';
import type { PreviewResponse } from '@/lib/email/journeys/api-types';
import {
  ANCHORS,
  type BlockContent,
  describeCondition,
  describeTiming,
  EXPIRY_ANCHORS,
  type JourneyDefinition,
  type JourneyStep,
  journeyCampaign,
  type StepContent,
  type StepTiming,
  TIMING_ANCHORS,
  type TimingAnchor,
} from '@/lib/email/journeys/schema';
import { BlockEditor } from './BlockEditor';
import { CustomerPicker, type PickedCustomer } from './CustomerPicker';
import { Field, FieldLabel, Section } from './Field';
import {
  badgeClass,
  buttonClass,
  compactInputClass,
  compactSelectClass,
  goldButtonClass,
  newStep,
  uniqueStepKey,
} from './journeyUi';
import { ActionList, ConditionList } from './RuleLists';
import { DragHandle, SortableList } from './Sortable';

const TIPS = {
  timeline:
    'Steps run top to bottom, one at a time. Drag a step by its handle to change the order. A step timed "after the previous email" counts from whichever step sits above it.',
  name: 'Only staff see this. Name the step after what the email does, e.g. "Prorate offer".',
  key: 'The permanent id of this step. It is part of the send history, so it never changes - even if you rename or move the step.',
  timing:
    'When this step runs. Count from when they entered (for bookings, when the session ends), from the previous email, or from an expiry date. Emails only go out 9am-8pm Eastern; anything due overnight waits for the morning.',
  skipIf:
    'Checked against live Momence data just before this step. If any is true, this step is skipped for that person and they move on to the next one. Use two steps with opposite conditions to send different emails to different people.',
  actions:
    'Momence tag changes made just before the email goes out - e.g. add a "Win-back Discount" tag that a Momence Price Rule turns into a discount.',
  content:
    'Write an email, or send nothing: a no-email step just waits for its time and runs its tag actions (e.g. to end a discount window).',
} as const;

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

  const addStep = () => {
    const step = newStep(steps);
    setSteps([...steps, step]);
    setSelected(step.key);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <FieldLabel label="Timeline" tip={TIPS.timeline} />
          <span className="text-xs text-white/40">
            {steps.filter((s) => !s.archived).length} of {steps.length} live
          </span>
        </div>
        {steps.length === 0 && (
          <p className="rounded border border-dashed border-white/15 p-4 text-sm text-white/50">
            No steps yet. Add the first email.
          </p>
        )}
        <SortableList
          items={steps}
          getId={(s) => s.key}
          getLabel={(s) => s.name || s.key}
          onReorder={setSteps}
          className="relative flex flex-col gap-2"
        >
          {(step, i, drag) => (
            <div
              className={`flex items-stretch gap-1 rounded-lg border transition-colors ${
                current?.key === step.key
                  ? 'border-[var(--pyre-gold)]/70 bg-[var(--pyre-gold)]/10'
                  : 'border-white/10 bg-white/[0.03] hover:border-white/30'
              } ${step.archived ? 'opacity-50' : ''} ${drag.isDragging ? 'bg-[var(--pyre-black)]' : ''}`}
            >
              <div className="flex items-center pl-1">
                <DragHandle drag={drag} label={step.name || step.key} />
              </div>
              <button
                type="button"
                onClick={() => setSelected(step.key)}
                className="min-w-0 flex-1 py-2.5 pr-3 text-left"
                aria-current={current?.key === step.key ? 'step' : undefined}
              >
                <span className="flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/25 font-mono text-[10px] text-white/60">
                    {i + 1}
                  </span>
                  <span className="truncate text-sm font-medium text-[var(--pyre-creme)]">
                    {step.name || step.key}
                  </span>
                </span>
                <span className="mt-1 block font-mono text-[10px] uppercase tracking-wide text-[var(--pyre-gold)]/80">
                  {describeTiming(step.timing, sessionTrigger)}
                </span>
                <span className="mt-0.5 block truncate text-xs text-white/45">
                  {step.archived
                    ? 'Archived - skipped'
                    : step.content.type === 'blocks'
                      ? step.content.subject
                      : 'No email - tag actions only'}
                </span>
                {step.skipIf.length > 0 && !step.archived && (
                  <span className="mt-0.5 block truncate text-[11px] text-white/40">
                    Skipped if {step.skipIf.map(describeCondition).join(' or ').toLowerCase()}
                  </span>
                )}
              </button>
            </div>
          )}
        </SortableList>
        <button type="button" className={`${goldButtonClass} self-start`} onClick={addStep}>
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
          saved={savedStepKeys.has(current.key)}
          sessionTrigger={sessionTrigger}
          tags={tags}
          viewerEmail={viewerEmail}
          onChange={(patch) => updateStep(current.key, patch)}
          onDuplicate={() => {
            const copy: JourneyStep = {
              ...structuredClone(current),
              key: uniqueStepKey(`${current.key}-copy`, steps),
              name: `${current.name || current.key} (copy)`,
              archived: false,
            };
            const at = steps.indexOf(current) + 1;
            setSteps([...steps.slice(0, at), copy, ...steps.slice(at)]);
            setSelected(copy.key);
          }}
          onDelete={() => {
            setSteps(steps.filter((s) => s.key !== current.key));
            setSelected(null);
          }}
        />
      ) : (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-white/15 p-6">
          <p className="text-sm text-white/60">Pick a step on the left, or add one.</p>
        </div>
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

function anchorLabel(anchor: TimingAnchor, sessionTrigger: boolean): string {
  if (anchor === 'trigger') return sessionTrigger ? 'the session ends' : 'they enter the journey';
  if (anchor === 'previous') return 'the previous email';
  if (anchor === 'intro-expiry') return 'their intro offer expires';
  return 'their credits expire';
}

/** Reads as a sentence: "Send it [4] [hours] [after] [the session ends]". */
function TimingEditor({
  timing,
  onChange,
  sessionTrigger,
}: {
  timing: StepTiming;
  onChange: (t: StepTiming) => void;
  sessionTrigger: boolean;
}) {
  const ids = useId();
  const { amount, unit, before } = splitOffset(timing.offsetHours);
  const set = (next: { amount?: number; unit?: Unit; before?: boolean; anchor?: TimingAnchor }) => {
    const a = next.amount ?? amount;
    const u = next.unit ?? unit;
    const anchor = next.anchor ?? timing.anchor;
    // Only the expiry dates can be counted backwards from.
    const b = EXPIRY_ANCHORS.includes(anchor) ? (next.before ?? before) : false;
    onChange({ anchor, offsetHours: (b ? -1 : 1) * a * UNITS[u] });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm text-white/80">
        <span>Send it</span>
        <input
          id={`${ids}-amount`}
          aria-label="How long"
          type="number"
          min={0}
          step="any"
          className={`${compactInputClass} w-20`}
          value={amount}
          onChange={(e) => set({ amount: Math.max(0, Number(e.target.value) || 0) })}
        />
        <select
          aria-label="Unit"
          className={compactSelectClass}
          value={unit}
          onChange={(e) => set({ unit: e.target.value as Unit })}
        >
          <option value="hours">hours</option>
          <option value="days">days</option>
        </select>
        {EXPIRY_ANCHORS.includes(timing.anchor) ? (
          <select
            aria-label="Before or after"
            className={compactSelectClass}
            value={before ? 'before' : 'after'}
            onChange={(e) => set({ before: e.target.value === 'before' })}
          >
            <option value="before">before</option>
            <option value="after">after</option>
          </select>
        ) : (
          <span>after</span>
        )}
        <select
          aria-label="Counted from"
          className={compactSelectClass}
          value={timing.anchor}
          onChange={(e) => set({ anchor: e.target.value as TimingAnchor })}
        >
          {TIMING_ANCHORS.map((a) => (
            <option key={a} value={a}>
              {anchorLabel(a, sessionTrigger)}
            </option>
          ))}
        </select>
      </div>
      <p className="text-xs leading-relaxed text-white/45">
        {timing.anchor === 'trigger' && sessionTrigger
          ? 'Counted from when the booked session ends.'
          : ANCHORS[timing.anchor].description}
      </p>
    </div>
  );
}

function StepEditor({
  journeyId,
  campaign,
  step,
  index,
  saved,
  sessionTrigger,
  tags,
  viewerEmail,
  onChange,
  onDuplicate,
  onDelete,
}: {
  journeyId: string;
  campaign: string;
  step: JourneyStep;
  index: number;
  saved: boolean;
  sessionTrigger: boolean;
  tags: string[];
  viewerEmail: string;
  onChange: (patch: Partial<JourneyStep>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const ids = useId();
  const setContentType = (type: StepContent['type']) => {
    if (type === step.content.type) return;
    if (type === 'blocks') {
      onChange({ content: newStep([]).content });
    } else {
      onChange({ content: { type: 'none' } });
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field
            label={`Step ${index + 1} name`}
            tip={TIPS.name}
            htmlFor={`${ids}-name`}
            className="min-w-0 flex-1"
          >
            <input
              id={`${ids}-name`}
              className={`${compactInputClass} w-full text-base`}
              value={step.name}
              placeholder="e.g. Prorate offer"
              onChange={(e) => onChange({ name: e.target.value })}
            />
          </Field>
          <div className="flex gap-1.5">
            <button type="button" className={buttonClass} onClick={onDuplicate}>
              Duplicate
            </button>
            {saved ? (
              <button
                type="button"
                className={buttonClass}
                onClick={() => onChange({ archived: !step.archived })}
                title="Saved steps can't be deleted - people may be waiting on them. Archived steps are skipped."
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
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-white/35">
          <span>
            Step id <span className="font-mono">{step.key}</span>
          </span>
          <InfoTip label="the step id" text={TIPS.key} />
        </p>
        {step.archived && (
          <p className={`${badgeClass('off')} mt-2`}>
            Archived: everyone skips this step. Restore it to send it again.
          </p>
        )}
      </div>

      <Section number={1} title="When it goes out" aside={<InfoTipInline text={TIPS.timing} />}>
        <TimingEditor
          timing={step.timing}
          onChange={(timing) => onChange({ timing })}
          sessionTrigger={sessionTrigger}
        />
      </Section>

      <Section
        number={2}
        title="Skip it for some people"
        description="If any of these is true for someone, this step is skipped for them."
        aside={<InfoTipInline text={TIPS.skipIf} />}
      >
        <ConditionList
          conditions={step.skipIf}
          onChange={(skipIf) => onChange({ skipIf })}
          allowSession={sessionTrigger}
          tags={tags}
          emptyText="Everyone gets this step."
          addLabel="Add skip condition"
        />
      </Section>

      <Section
        number={3}
        title="Before it sends"
        description="Tag changes in Momence, made just before the email goes out."
        aside={<InfoTipInline text={TIPS.actions} />}
      >
        <ActionList
          actions={step.actions}
          onChange={(actions) => onChange({ actions })}
          tags={tags}
          emptyText="No tag changes."
        />
      </Section>

      <Section number={4} title="The email" aside={<InfoTipInline text={TIPS.content} />}>
        <div
          className="grid gap-2 sm:grid-cols-2"
          role="radiogroup"
          aria-label="What this step sends"
        >
          {(
            [
              ['blocks', 'Send an email', 'Write it below, with a live preview.'],
              ['none', 'No email', 'Just wait for its time and run the tag changes above.'],
            ] as const
          ).map(([value, title, text]) => (
            <label
              key={value}
              className={`cursor-pointer rounded border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--pyre-gold)]/60 ${
                step.content.type === value
                  ? 'border-[var(--pyre-gold)]/70 bg-[var(--pyre-gold)]/10'
                  : 'border-white/10 hover:border-white/30'
              }`}
            >
              <input
                type="radio"
                className="sr-only"
                name={`${ids}-content`}
                checked={step.content.type === value}
                onChange={() => setContentType(value)}
              />
              <span className="block text-sm font-medium text-[var(--pyre-creme)]">{title}</span>
              <span className="mt-0.5 block text-xs text-white/50">{text}</span>
            </label>
          ))}
        </div>

        {step.content.type === 'blocks' && (
          <div className="grid gap-4 xl:grid-cols-2">
            <BlockEditor
              content={step.content}
              onChange={(content: BlockContent) => onChange({ content })}
              campaign={campaign}
              stepKey={step.key}
            />
            <div className="xl:sticky xl:top-4 xl:self-start">
              <EmailPreview
                journeyId={journeyId}
                campaign={campaign}
                stepKey={step.key}
                content={step.content}
                viewerEmail={viewerEmail}
              />
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

/** An "i" tip with no visible label (the section title is the label). */
function InfoTipInline({ text }: { text: string }) {
  return <InfoTip label="this" text={text} align="right" />;
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

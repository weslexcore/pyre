// The People tab: who is in the journey now, who finished or left (and why),
// and every email each person got from it — delivered, opened, clicked — with
// a step-by-step log. Also where to add someone by hand or take someone out,
// and, for whitelisted test addresses, walk them through the journey without
// waiting (run the next step now, move to a step, start over).

import { useState } from 'react';
import { confirmAction } from '@/components/admin/ConfirmDialog';
import { ErrorBanner } from '@/components/admin/ErrorBanner';
import { sendJson } from '@/lib/client/api';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import { fmtDateTime } from '@/lib/client/format';
import type {
  EnrollmentDto,
  EnrollmentsResponse,
  StepEventDto,
} from '@/lib/email/journeys/api-types';
import type { JourneyDefinition } from '@/lib/email/journeys/schema';
import { CustomerPicker, type PickedCustomer } from './CustomerPicker';
import {
  badgeClass,
  buttonClass,
  cardClass,
  compactInputClass,
  compactSelectClass,
  pillClass,
} from './journeyUi';

type StatusFilter = 'all' | 'active' | 'completed' | 'exited';

export function PeoplePanel({
  journeyId,
  definition,
  testMode,
}: {
  journeyId: string;
  definition: JourneyDefinition;
  testMode: boolean;
}) {
  const [status, setStatus] = useState<StatusFilter>('active');
  const [query, setQuery] = useState('');
  const [toAdd, setToAdd] = useState<PickedCustomer | null>(null);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (status !== 'all') params.set('status', status);
  if (query.trim()) params.set('q', query.trim());
  const url = `/api/admin/journeys/${journeyId}/enrollments?${params}`;
  const { data, error, reload } = useCachedJson<EnrollmentsResponse>(url, { maxAgeMs: 15_000 });

  const stepName = (key: string | null) =>
    key ? definition.steps.find((s) => s.key === key)?.name || key : '';

  const enroll = async () => {
    if (!toAdd) return;
    setMessage(null);
    setAdding(true);
    try {
      const result = await sendJson<{ message: string }>(
        `/api/admin/journeys/${journeyId}/enrollments`,
        'POST',
        { action: 'enroll', memberId: toAdd.memberId }
      );
      setMessage({ ok: true, text: result.message });
      setToAdd(null);
      invalidateJson(`/api/admin/journeys/${journeyId}`);
      await reload();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setAdding(false);
    }
  };

  const remove = async (row: EnrollmentDto) => {
    const ok = await confirmAction({
      title: `Remove ${row.email} from this journey?`,
      body: 'They get no more emails from it. Any end-of-journey tag actions run now.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      await sendJson(`/api/admin/journeys/${journeyId}/enrollments`, 'POST', {
        action: 'exit',
        enrollmentId: row.id,
      });
      invalidateJson(`/api/admin/journeys/${journeyId}`);
      await reload();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  const counts = data?.counts;

  return (
    <div className="flex flex-col gap-4">
      <div className={`${cardClass} flex flex-col gap-2`}>
        <p className="text-sm text-white/70">
          Add someone by hand. They start at the first step now
          {testMode ? ' (test mode: only whitelisted addresses can be added)' : ''}. People who
          already went through this journey start a fresh run - its emails go to them again.
          {definition.trigger.type === 'session-booked' &&
            ' They have no booked session, so steps that check the session are skipped.'}
        </p>
        <div className="flex flex-wrap items-start gap-1.5">
          <div className="min-w-0 flex-1">
            <CustomerPicker
              id="journey-add-customer"
              label="Add"
              placeholder="Search a customer by name or email"
              clearLabel="Change"
              selected={toAdd}
              onSelect={setToAdd}
            />
          </div>
          <button
            type="button"
            className={buttonClass}
            onClick={() => void enroll()}
            disabled={!toAdd || adding}
          >
            {adding ? 'Adding...' : 'Add to journey'}
          </button>
        </div>
        {message &&
          (message.ok ? (
            <p className="text-xs text-emerald-400">{message.text}</p>
          ) : (
            <ErrorBanner mono>{message.text}</ErrorBanner>
          ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {(['active', 'completed', 'exited', 'all'] as StatusFilter[]).map((s) => (
          <button
            key={s}
            type="button"
            className={pillClass(status === s)}
            onClick={() => setStatus(s)}
          >
            {s === 'active' ? 'In it now' : s === 'all' ? 'Everyone' : s}
            {counts && s !== 'all' ? ` ${counts[s]}` : ''}
          </button>
        ))}
        <input
          className={`${compactInputClass} ml-auto w-56`}
          placeholder="Search email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}
      {data && data.enrollments.length === 0 && (
        <p className="text-sm text-white/40">Nobody here.</p>
      )}

      <ul className="flex flex-col gap-1">
        {data?.enrollments.map((row) => (
          <li key={row.id} className="rounded border border-white/10 bg-white/[0.03]">
            <div className="flex items-center gap-2 pr-2">
              <button
                type="button"
                className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left"
                onClick={() => setOpen(open === row.id ? null : row.id)}
                aria-expanded={open === row.id}
              >
                <span className="min-w-0 flex-1 truncate text-sm">{row.email}</span>
                {row.cycle > 0 && <span className={badgeClass('off')}>run {row.cycle + 1}</span>}
                <span className="font-mono text-[11px] text-white/50">
                  {row.status === 'active'
                    ? `Next: ${stepName(row.currentStepKey)}${row.nextAt ? ` · ${fmtDateTime(row.nextAt)}` : ''}`
                    : row.status === 'completed'
                      ? `Finished ${row.endedAt ? fmtDateTime(row.endedAt) : ''}`
                      : `Left: ${row.exitReason ?? ''}`}
                </span>
                <span className="font-mono text-[11px] text-white/30">
                  {row.sends.filter((s) => s.status === 'sent').length} sent
                </span>
              </button>
              {row.status === 'active' && (
                <button type="button" className={buttonClass} onClick={() => void remove(row)}>
                  Remove
                </button>
              )}
            </div>
            {open === row.id && (
              <div className="border-t border-white/10 px-3 py-2">
                <p className="font-mono text-[11px] text-white/40">
                  Enrolled {fmtDateTime(row.enrolledAt)} · Momence member {row.memberId}
                </p>
                {row.status === 'active' && (
                  <TestControls
                    journeyId={journeyId}
                    row={row}
                    definition={definition}
                    onDone={async () => {
                      invalidateJson(`/api/admin/journeys/${journeyId}`);
                      await reload();
                    }}
                  />
                )}
                <StepLog row={row} stepName={stepName} />
                <p className="mt-3 font-mono text-[10px] uppercase tracking-wide text-white/30">
                  Emails
                </p>
                {row.sends.length === 0 ? (
                  <p className="mt-1 text-xs text-white/40">No emails yet.</p>
                ) : (
                  <table className="mt-2 w-full text-left text-xs">
                    <thead className="font-mono text-[10px] uppercase tracking-wide text-white/30">
                      <tr>
                        <th className="py-1 pr-2 font-normal">Step</th>
                        <th className="py-1 pr-2 font-normal">Sent</th>
                        <th className="py-1 pr-2 font-normal">Delivered</th>
                        <th className="py-1 pr-2 font-normal">Opened</th>
                        <th className="py-1 font-normal">Clicked</th>
                      </tr>
                    </thead>
                    <tbody>
                      {row.sends.map((s) => (
                        <tr
                          key={`${s.stepId}-${s.sentAt}`}
                          className="border-t border-white/5 align-top"
                        >
                          <td className="py-1 pr-2">
                            {stepName(s.stepId)}
                            {s.subject && <span className="block text-white/40">{s.subject}</span>}
                          </td>
                          <td className="py-1 pr-2">
                            {s.status === 'sent'
                              ? fmtDateTime(s.sentAt)
                              : `${s.status}${s.error ? `: ${s.error}` : ''}`}
                          </td>
                          <td className="py-1 pr-2">
                            {s.bouncedAt
                              ? 'Bounced'
                              : s.deliveredAt
                                ? fmtDateTime(s.deliveredAt)
                                : '-'}
                          </td>
                          <td className="py-1 pr-2">
                            {s.openedAt ? fmtDateTime(s.openedAt) : '-'}
                          </td>
                          <td className="py-1">{s.clickedAt ? fmtDateTime(s.clickedAt) : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {data?.truncated && (
        <p className="text-xs text-white/40">Showing the newest 200. Search to narrow.</p>
      )}
    </div>
  );
}

const EVENT_LABELS: Record<StepEventDto['kind'], string> = {
  enrolled: 'Entered the journey',
  sent: 'Sent',
  skipped: 'Skipped',
  deferred: 'Waiting',
  exited: 'Left the journey',
  completed: 'Finished the journey',
  moved: 'Moved to this step',
  restarted: 'Run restarted',
};

/** Every step outcome for this run, oldest first. */
function StepLog({
  row,
  stepName,
}: {
  row: EnrollmentDto;
  stepName: (key: string | null) => string;
}) {
  if (row.events.length === 0) return null;
  return (
    <>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-wide text-white/30">
        Step by step
      </p>
      <ol className="mt-1 flex flex-col gap-0.5 text-xs">
        {row.events.map((e, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: an append-only log; position is identity
          <li key={i} className="flex flex-wrap gap-x-2">
            <span className="w-28 shrink-0 font-mono text-[11px] text-white/35">
              {fmtDateTime(e.at)}
            </span>
            <span
              className={
                e.kind === 'sent'
                  ? 'text-emerald-400'
                  : e.kind === 'exited'
                    ? 'text-[var(--pyre-red)]'
                    : 'text-white/70'
              }
            >
              {EVENT_LABELS[e.kind]}
              {e.stepKey && e.kind !== 'exited' && e.kind !== 'completed'
                ? ` "${stepName(e.stepKey)}"`
                : ''}
            </span>
            {e.detail && <span className="text-white/45">- {e.detail}</span>}
          </li>
        ))}
      </ol>
    </>
  );
}

/**
 * Test controls for one run. Only offered (and only accepted by the API) for
 * whitelisted addresses: they skip the journey's waiting times, so they must
 * never touch a real customer.
 */
function TestControls({
  journeyId,
  row,
  definition,
  onDone,
}: {
  journeyId: string;
  row: EnrollmentDto;
  definition: JourneyDefinition;
  onDone: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [target, setTarget] = useState(row.currentStepKey ?? '');

  if (!row.testable) {
    return (
      <p className="mt-2 text-[11px] text-white/35">
        Test controls (run the next step now, jump to a step, start over) are available for
        whitelisted addresses.
      </p>
    );
  }

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setResult(null);
    try {
      const res = await sendJson<{ message: string }>(
        `/api/admin/journeys/${journeyId}/enrollments`,
        'POST',
        {
          enrollmentId: row.id,
          ...body,
        }
      );
      setResult({ ok: true, text: res.message });
      await onDone();
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const live = definition.steps.filter((st) => !st.archived);

  return (
    <div className="mt-2 rounded border border-[var(--pyre-gold)]/30 bg-[var(--pyre-gold)]/5 p-2">
      <p className="font-mono text-[10px] uppercase tracking-wide text-[var(--pyre-gold)]">
        Test this run
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={buttonClass}
          disabled={busy}
          onClick={() => void act({ action: 'run-now' })}
        >
          {busy ? 'Working...' : 'Run next step now'}
        </button>
        <select
          className={compactSelectClass}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          aria-label="Step to move to"
          disabled={busy}
        >
          {live.map((st) => (
            <option key={st.key} value={st.key}>
              {st.name || st.key}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={buttonClass}
          disabled={busy || !target}
          onClick={() => void act({ action: 'move', stepKey: target })}
        >
          Jump to step
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={busy}
          onClick={async () => {
            const ok = await confirmAction({
              title: 'Start this run over?',
              body: 'Ends this run and starts a fresh one from the first step. Every email sends again. End-of-journey tag actions run for the run being ended.',
              confirmLabel: 'Start over',
            });
            if (ok) await act({ action: 'restart' });
          }}
        >
          Start over
        </button>
      </div>
      <p className="mt-1 text-[11px] text-white/40">
        Runs the real step - exit rules, skip rules, tag actions and the email - but ignores its
        timing, the send window and the one-a-day limit.
      </p>
      {result &&
        (result.ok ? (
          <p className="mt-1 text-xs text-emerald-400">{result.text}</p>
        ) : (
          <ErrorBanner mono>{result.text}</ErrorBanner>
        ))}
    </div>
  );
}

// The People tab: who is in the journey now, who finished or left (and why),
// and every email each person got from it — delivered, opened, clicked. Also
// where to add someone by hand or take someone out.

import { useState } from 'react';
import { confirmAction } from '@/components/admin/ConfirmDialog';
import { ErrorBanner } from '@/components/admin/ErrorBanner';
import { sendJson } from '@/lib/client/api';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import { fmtDateTime } from '@/lib/client/format';
import type { EnrollmentDto, EnrollmentsResponse } from '@/lib/email/journeys/api-types';
import type { JourneyDefinition } from '@/lib/email/journeys/schema';
import { badgeClass, buttonClass, cardClass, compactInputClass, pillClass } from './journeyUi';

type StatusFilter = 'all' | 'active' | 'completed' | 'exited';

const EXIT_REASONS: Record<string, string> = {
  unsubscribed: 'Unsubscribed',
  'not-whitelisted': 'Not on the test whitelist',
  'journey-removed': 'Journey removed',
};

function describeExit(reason: string | null): string {
  if (!reason) return '';
  if (EXIT_REASONS[reason]) return EXIT_REASONS[reason];
  if (reason.startsWith('exit:')) return `Exit rule: ${reason.slice(5).replace(/-/g, ' ')}`;
  if (reason.startsWith('removed-by:')) return `Removed by ${reason.slice(11)}`;
  return reason;
}

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
  const [enrollEmail, setEnrollEmail] = useState('');
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
    setMessage(null);
    try {
      const result = await sendJson<{ message: string }>(
        `/api/admin/journeys/${journeyId}/enrollments`,
        'POST',
        {
          action: 'enroll',
          email: enrollEmail,
        }
      );
      setMessage({ ok: true, text: result.message });
      setEnrollEmail('');
      invalidateJson(`/api/admin/journeys/${journeyId}`);
      await reload();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  const remove = async (row: EnrollmentDto) => {
    const ok = await confirmAction({
      title: `Take ${row.email} out of this journey?`,
      body: 'They get no more emails from it. Any end-of-journey tag actions run now.',
      confirmLabel: 'Take out',
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
          Add someone by hand
          {testMode ? ' (test mode: only whitelisted addresses can be added)' : ''}.
          {definition.trigger.type === 'session-booked' &&
            ' They start without a booked session, so steps that check the session are skipped.'}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <input
            className={`${compactInputClass} min-w-0 flex-1`}
            placeholder="customer@email.com"
            value={enrollEmail}
            onChange={(e) => setEnrollEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void enroll();
            }}
          />
          <button
            type="button"
            className={buttonClass}
            onClick={() => void enroll()}
            disabled={!enrollEmail.trim()}
          >
            Enroll
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
            <button
              type="button"
              className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left"
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
                    : `Left: ${describeExit(row.exitReason)}`}
              </span>
              <span className="font-mono text-[11px] text-white/30">
                {row.sends.filter((s) => s.status === 'sent').length} sent
              </span>
            </button>
            {open === row.id && (
              <div className="border-t border-white/10 px-3 py-2">
                <p className="font-mono text-[11px] text-white/40">
                  Enrolled {fmtDateTime(row.enrolledAt)} · Momence member {row.memberId}
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
                {row.status === 'active' && (
                  <button
                    type="button"
                    className={`${buttonClass} mt-2`}
                    onClick={() => void remove(row)}
                  >
                    Take out of journey
                  </button>
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

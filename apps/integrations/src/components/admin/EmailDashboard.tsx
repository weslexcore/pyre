import { useCallback, useEffect, useState } from 'react';

// Email monitoring dashboard island. All data comes from the admin-gated
// /api/admin/email-stats endpoint; this component only renders it.

// Status colors validated for the dark Pyre surface (#23221c) — lightness band,
// chroma floor, CVD separation, and contrast all pass; segment gaps + legend
// provide the secondary encoding.
const STATUS_COLORS: Record<SendStatus, string> = {
  sent: '#68994c',
  failed: '#d15232',
  suppressed: '#ab9017',
  skipped: '#4086bd',
};
const STATUS_ORDER: SendStatus[] = ['sent', 'failed', 'suppressed', 'skipped'];

type SendStatus = 'sent' | 'failed' | 'suppressed' | 'skipped';

interface DailyPoint {
  date: string;
  sent: number;
  failed: number;
  suppressed: number;
  skipped: number;
}

interface SendRow {
  id: string;
  email: string;
  template: string;
  kind: string;
  journey_id: string | null;
  step_id: string | null;
  campaign: string | null;
  status: SendStatus;
  error: string | null;
  sent_at: string;
}

interface TemplateStat {
  template: string;
  kind: string;
  journeyId: string | null;
  sent: number;
  failed: number;
  suppressed: number;
  skipped: number;
}

interface JourneyStat {
  id: string;
  kind: string | null;
  stepCount: number | null;
  registered: boolean;
  active: number;
  completed: number;
  exited: number;
  overdue: number;
  nextDueAt: string | null;
}

interface UpcomingStep {
  journey_id: string;
  email: string;
  member_id: number;
  step: number;
  next_at: string;
}

interface EnrollmentRow {
  journey_id: string;
  email: string;
  member_id: number;
  step: number;
  status: string;
  exit_reason: string | null;
  enrolled_at: string;
}

interface SuppressionRow {
  email: string;
  reason: string;
  source: string | null;
  created_at: string;
}

interface EmailStats {
  generatedAt: string;
  days: number;
  totals: {
    sent: number;
    failed: number;
    suppressed: number;
    skipped: number;
    attempted: number;
    failureRate: number;
  };
  daily: DailyPoint[];
  templates: TemplateStat[];
  recentIssues: SendRow[];
  recentSends: SendRow[];
  suppressions: {
    total: number;
    byReason: Record<string, number>;
    newInWindow: number;
    newByReason: Record<string, number>;
    recent: SuppressionRow[];
  };
  journeys: JourneyStat[];
  upcomingSteps: UpcomingStep[];
  recentEnrollments: EnrollmentRow[];
  truncated: { sends: boolean; suppressions: boolean; enrollments: boolean };
}

const RANGES = [7, 14, 30, 90];
const REFRESH_MS = 60_000;

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(diffMs);
  const mins = Math.round(abs / 60_000);
  let text: string;
  if (mins < 1) text = 'now';
  else if (mins < 60) text = `${mins}m`;
  else if (mins < 48 * 60) text = `${Math.round(mins / 60)}h`;
  else text = `${Math.round(mins / (24 * 60))}d`;
  if (text === 'now') return text;
  return diffMs >= 0 ? `${text} ago` : `in ${text}`;
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function EmailDashboard() {
  const [days, setDays] = useState(14);
  const [data, setData] = useState<EmailStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (rangeDays: number, background = false) => {
    if (!background) setLoading(true);
    try {
      const res = await fetch(`/api/admin/email-stats?days=${rangeDays}`);
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setData((await res.json()) as EmailStats);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(days);
    const interval = setInterval(() => load(days, true), REFRESH_MS);
    return () => clearInterval(interval);
  }, [days, load]);

  if (loading && !data) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--pyre-red)] border-t-transparent" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-lg border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 p-6">
        <p className="text-sm">{error}</p>
        <button
          type="button"
          onClick={() => load(days)}
          className="mt-3 rounded-md border border-white/20 px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-wide hover:bg-white/10"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const anyTruncated =
    data.truncated.sends || data.truncated.suppressions || data.truncated.enrollments;
  const totalActive = data.journeys.reduce((sum, j) => sum + j.active, 0);
  const totalOverdue = data.journeys.reduce((sum, j) => sum + j.overdue, 0);

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-md border border-white/10 p-1">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setDays(r)}
              className={`rounded px-3 py-1 font-mono text-xs font-bold uppercase tracking-wide transition-colors ${
                days === r
                  ? 'bg-white/15 text-[var(--pyre-creme)]'
                  : 'text-white/50 hover:text-white'
              }`}
            >
              {r}d
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 font-mono text-xs text-white/40">
          {error && (
            <span className="text-[var(--pyre-red)]">refresh failed — showing stale data</span>
          )}
          <span>updated {timeAgo(data.generatedAt)}</span>
          <button
            type="button"
            onClick={() => load(days)}
            className="rounded-md border border-white/20 px-3 py-1.5 font-bold uppercase tracking-wide text-[var(--pyre-creme)] transition-colors hover:border-white/40 hover:bg-white/10"
          >
            Refresh
          </button>
        </div>
      </div>

      {anyTruncated && (
        <p className="rounded-md border border-[var(--pyre-gold)]/40 bg-[var(--pyre-gold)]/10 px-3 py-2 font-mono text-xs text-white/70">
          Some aggregates hit their row cap for this window — narrow the range for exact numbers.
        </p>
      )}

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile
          label={`Sent · ${data.days}d`}
          value={data.totals.sent}
          dot={STATUS_COLORS.sent}
        />
        <StatTile
          label={`Failed · ${data.days}d`}
          value={data.totals.failed}
          dot={STATUS_COLORS.failed}
          alert={data.totals.failed > 0}
          sub={
            data.totals.attempted > 0
              ? `${(data.totals.failureRate * 100).toFixed(1)}% of attempts`
              : undefined
          }
        />
        <StatTile
          label={`Suppressed · ${data.days}d`}
          value={data.totals.suppressed}
          dot={STATUS_COLORS.suppressed}
        />
        <StatTile
          label={`Skipped · ${data.days}d`}
          value={data.totals.skipped}
          dot={STATUS_COLORS.skipped}
        />
        <StatTile label="Active enrollments" value={totalActive} />
        <StatTile
          label="Overdue steps"
          value={totalOverdue}
          alert={totalOverdue > 0}
          sub={totalOverdue > 0 ? 'cron may be behind' : undefined}
        />
      </div>

      {/* Daily sends chart */}
      <Card title="Daily sends" subtitle="stacked by outcome (UTC days)">
        <DailyChart daily={data.daily} totals={data.totals} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Journeys */}
        <Card title="Journeys" subtitle="enrollment state per journey">
          {data.journeys.length === 0 ? (
            <Empty>No journeys defined.</Empty>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="font-mono text-[10px] uppercase tracking-wide text-white/40">
                  <th className="pb-2 pr-3 font-normal">Journey</th>
                  <th className="pb-2 pr-3 text-right font-normal">Active</th>
                  <th className="pb-2 pr-3 text-right font-normal">Overdue</th>
                  <th className="pb-2 pr-3 text-right font-normal">Done</th>
                  <th className="pb-2 pr-3 text-right font-normal">Exited</th>
                  <th className="pb-2 font-normal">Next due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.journeys.map((j) => (
                  <tr key={j.id}>
                    <td className="py-2 pr-3">
                      <span className="font-mono text-xs">{j.id}</span>
                      <span className="ml-2 text-[10px] text-white/40">
                        {j.stepCount != null ? `${j.stepCount} steps` : ''}
                        {!j.registered && ' · unregistered'}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{j.active}</td>
                    <td
                      className={`py-2 pr-3 text-right tabular-nums ${j.overdue > 0 ? 'font-bold text-[#d15232]' : ''}`}
                    >
                      {j.overdue}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{j.completed}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{j.exited}</td>
                    <td className="py-2 font-mono text-xs text-white/60">
                      {j.nextDueAt ? timeAgo(j.nextDueAt).replace('ago', 'overdue') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* Upcoming steps */}
        <Card title="Upcoming journey sends" subtitle="next due steps across active enrollments">
          {data.upcomingSteps.length === 0 ? (
            <Empty>Nothing queued.</Empty>
          ) : (
            <ul className="divide-y divide-white/5 text-sm">
              {data.upcomingSteps.map((s) => {
                const overdue = new Date(s.next_at).getTime() < Date.now();
                return (
                  <li
                    key={`${s.journey_id}-${s.member_id}`}
                    className="flex items-center justify-between gap-3 py-2"
                  >
                    <div className="min-w-0">
                      <span className="block truncate">{s.email}</span>
                      <span className="font-mono text-[10px] text-white/40">
                        {s.journey_id} · step {s.step + 1}
                      </span>
                    </div>
                    <span
                      className={`shrink-0 font-mono text-xs ${overdue ? 'font-bold text-[#d15232]' : 'text-white/60'}`}
                      title={fmtDateTime(s.next_at)}
                    >
                      {overdue
                        ? `${timeAgo(s.next_at).replace(' ago', '')} overdue`
                        : timeAgo(s.next_at)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {/* Recent issues */}
      <Card
        title="Recent issues"
        subtitle="failed and suppressed sends, newest first"
        accent={data.recentIssues.some((r) => r.status === 'failed')}
      >
        {data.recentIssues.length === 0 ? (
          <Empty>No failed or suppressed sends on record.</Empty>
        ) : (
          <SendTable rows={data.recentIssues} showError />
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Templates */}
        <Card title="By template" subtitle={`sends in the last ${data.days} days`}>
          {data.templates.length === 0 ? (
            <Empty>No sends in this window.</Empty>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="font-mono text-[10px] uppercase tracking-wide text-white/40">
                  <th className="pb-2 pr-3 font-normal">Template</th>
                  <th className="pb-2 pr-3 text-right font-normal">Sent</th>
                  <th className="pb-2 pr-3 text-right font-normal">Failed</th>
                  <th className="pb-2 pr-3 text-right font-normal">Suppr.</th>
                  <th className="pb-2 text-right font-normal">Skipped</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.templates.map((t) => (
                  <tr key={t.template}>
                    <td className="py-2 pr-3">
                      <span className="font-mono text-xs">{t.template}</span>
                      <span className="ml-2 text-[10px] text-white/40">
                        {t.journeyId ?? t.kind}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{t.sent}</td>
                    <td
                      className={`py-2 pr-3 text-right tabular-nums ${t.failed > 0 ? 'font-bold text-[#d15232]' : ''}`}
                    >
                      {t.failed}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{t.suppressed}</td>
                    <td className="py-2 text-right tabular-nums">{t.skipped}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* Suppressions */}
        <Card
          title="Suppression list"
          subtitle={`${data.suppressions.total} total · ${data.suppressions.newInWindow} new in ${data.days}d`}
        >
          <div className="mb-4 flex flex-wrap gap-2">
            {Object.entries(data.suppressions.byReason)
              .sort(([, a], [, b]) => b - a)
              .map(([reason, count]) => (
                <span
                  key={reason}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-xs"
                >
                  {reason}: {count}
                  {data.suppressions.newByReason[reason] ? (
                    <span className="text-white/40">
                      {' '}
                      (+{data.suppressions.newByReason[reason]})
                    </span>
                  ) : null}
                </span>
              ))}
            {data.suppressions.total === 0 && <Empty>No suppressions yet.</Empty>}
          </div>
          {data.suppressions.recent.length > 0 && (
            <ul className="divide-y divide-white/5 text-sm">
              {data.suppressions.recent.map((s) => (
                <li
                  key={`${s.email}-${s.created_at}`}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <div className="min-w-0">
                    <span className="block truncate">{s.email}</span>
                    <span className="font-mono text-[10px] text-white/40">
                      {s.reason}
                      {s.source ? ` · ${s.source}` : ''}
                    </span>
                  </div>
                  <span
                    className="shrink-0 font-mono text-xs text-white/60"
                    title={fmtDateTime(s.created_at)}
                  >
                    {timeAgo(s.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Recent sends" subtitle="latest send-log entries of any status">
          {data.recentSends.length === 0 ? (
            <Empty>Send log is empty.</Empty>
          ) : (
            <SendTable rows={data.recentSends} />
          )}
        </Card>

        <Card title="Recent enrollments" subtitle="latest journey enrollments">
          {data.recentEnrollments.length === 0 ? (
            <Empty>No enrollments yet.</Empty>
          ) : (
            <ul className="divide-y divide-white/5 text-sm">
              {data.recentEnrollments.map((e) => (
                <li
                  key={`${e.journey_id}-${e.member_id}`}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <div className="min-w-0">
                    <span className="block truncate">{e.email}</span>
                    <span className="font-mono text-[10px] text-white/40">
                      {e.journey_id} · step {e.step + 1} · {e.status}
                      {e.exit_reason ? ` (${e.exit_reason})` : ''}
                    </span>
                  </div>
                  <span
                    className="shrink-0 font-mono text-xs text-white/60"
                    title={fmtDateTime(e.enrolled_at)}
                  >
                    {timeAgo(e.enrolled_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

// --- Pieces ---

function Card({
  title,
  subtitle,
  accent = false,
  children,
}: {
  title: string;
  subtitle?: string;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`overflow-x-auto rounded-lg border bg-white/5 p-4 ${
        accent ? 'border-[#d15232]/40' : 'border-white/10'
      }`}
    >
      <div className="mb-3">
        <h2 className="font-mono text-sm font-bold uppercase tracking-wide">{title}</h2>
        {subtitle && <p className="mt-0.5 font-mono text-[10px] text-white/40">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function StatTile({
  label,
  value,
  sub,
  dot,
  alert = false,
}: {
  label: string;
  value: number;
  sub?: string;
  dot?: string;
  alert?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border bg-white/5 px-4 py-3 ${alert ? 'border-[#d15232]/50' : 'border-white/10'}`}
    >
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-white/40">
        {dot && (
          <span
            className="h-2 w-2 rounded-sm"
            style={{ backgroundColor: dot }}
            aria-hidden="true"
          />
        )}
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div>
      {sub && (
        <div
          className={`mt-0.5 font-mono text-[10px] ${alert ? 'text-[#d15232]' : 'text-white/40'}`}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-sm text-white/40">{children}</p>;
}

function StatusBadge({ status }: { status: SendStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs">
      <span
        className="h-2 w-2 rounded-sm"
        style={{ backgroundColor: STATUS_COLORS[status] }}
        aria-hidden="true"
      />
      {status}
    </span>
  );
}

function SendTable({ rows, showError = false }: { rows: SendRow[]; showError?: boolean }) {
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="font-mono text-[10px] uppercase tracking-wide text-white/40">
          <th className="pb-2 pr-3 font-normal">When</th>
          <th className="pb-2 pr-3 font-normal">Recipient</th>
          <th className="pb-2 pr-3 font-normal">Template</th>
          <th className="pb-2 font-normal">Status</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-white/5">
        {rows.map((row) => (
          <tr key={row.id}>
            <td
              className="whitespace-nowrap py-2 pr-3 font-mono text-xs text-white/60"
              title={fmtDateTime(row.sent_at)}
            >
              {timeAgo(row.sent_at)}
            </td>
            <td className="max-w-[180px] truncate py-2 pr-3">{row.email}</td>
            <td className="py-2 pr-3">
              <span className="font-mono text-xs">{row.template}</span>
              {row.journey_id && (
                <span className="ml-2 text-[10px] text-white/40">
                  {row.journey_id}
                  {row.step_id ? ` / ${row.step_id}` : ''}
                </span>
              )}
            </td>
            <td className="py-2">
              <StatusBadge status={row.status} />
              {showError && row.error && (
                <div
                  className="mt-0.5 max-w-[320px] truncate font-mono text-[10px] text-[#d15232]"
                  title={row.error}
                >
                  {row.error}
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const CHART_HEIGHT = 160;

function DailyChart({ daily, totals }: { daily: DailyPoint[]; totals: EmailStats['totals'] }) {
  const [hovered, setHovered] = useState<number | null>(null);

  const maxTotal = Math.max(...daily.map((d) => d.sent + d.failed + d.suppressed + d.skipped), 1);
  const hasAny = daily.some((d) => d.sent + d.failed + d.suppressed + d.skipped > 0);

  // ~5 evenly spaced x labels regardless of range length
  const labelEvery = Math.max(1, Math.round(daily.length / 5));
  const hoveredPoint = hovered != null ? daily[hovered] : null;

  if (!hasAny) return <Empty>No sends in this window.</Empty>;

  return (
    <div>
      {/* Legend + hover readout share a row; text stays in text tokens */}
      <div className="mb-3 flex min-h-5 flex-wrap items-center justify-between gap-2 font-mono text-xs">
        <div className="flex flex-wrap gap-4">
          {STATUS_ORDER.map((status) => (
            <span key={status} className="inline-flex items-center gap-1.5 text-white/70">
              <span
                className="h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: STATUS_COLORS[status] }}
                aria-hidden="true"
              />
              {status} <span className="text-white/40">{totals[status].toLocaleString()}</span>
            </span>
          ))}
        </div>
        <span className="tabular-nums text-white/60">
          {hoveredPoint
            ? `${hoveredPoint.date} — sent ${hoveredPoint.sent} · failed ${hoveredPoint.failed} · suppressed ${hoveredPoint.suppressed} · skipped ${hoveredPoint.skipped}`
            : `peak day ${maxTotal.toLocaleString()}`}
        </span>
      </div>

      <div className="relative" style={{ height: CHART_HEIGHT }}>
        {/* recessive gridlines at 50% and 100% of the peak */}
        <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-white/10" />
        <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-white/5" />
        <div className="flex h-full items-end gap-[2px]">
          {daily.map((d, i) => {
            const total = d.sent + d.failed + d.suppressed + d.skipped;
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: hover readout only; data is also in the tables
              <div
                key={d.date}
                className="group flex h-full min-w-0 flex-1 flex-col justify-end"
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
              >
                <div
                  className={`flex flex-col-reverse gap-[2px] rounded-t-[3px] ${
                    hovered === i ? 'opacity-100' : hovered != null ? 'opacity-60' : ''
                  }`}
                  title={`${d.date}: ${total} total`}
                >
                  {STATUS_ORDER.map((status) =>
                    d[status] > 0 ? (
                      <div
                        key={status}
                        style={{
                          height: Math.max(2, (d[status] / maxTotal) * (CHART_HEIGHT - 8)),
                          backgroundColor: STATUS_COLORS[status],
                        }}
                        className="w-full first:rounded-b-none last:rounded-t-[3px]"
                      />
                    ) : null
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-1 flex gap-[2px] font-mono text-[10px] text-white/40">
        {daily.map((d, i) => (
          <span key={d.date} className="min-w-0 flex-1 truncate">
            {i % labelEvery === 0 ? d.date.slice(5) : ' '}
          </span>
        ))}
      </div>
    </div>
  );
}

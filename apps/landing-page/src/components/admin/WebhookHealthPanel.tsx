import { useCallback, useEffect, useState } from 'react';

interface DailyStat {
  date: string;
  total: number;
  errors: number;
  avgDurationMs: number;
  byEventType: Record<string, { total: number; errors: number }>;
}

interface RecentFailure {
  id: string;
  timestamp: number;
  eventType: string;
  source: string;
  httpStatus: number;
  errorMessage: string;
  durationMs: number;
}

interface StatsResponse {
  generatedAt: string;
  days: DailyStat[];
  last24h: {
    total: number;
    errors: number;
    errorRate: number;
    p50DurationMs: number;
    p95DurationMs: number;
  };
  recentFailures: RecentFailure[];
}

const DAY_OPTIONS = [7, 30, 90] as const;

function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-white/40">{label}</div>
      <div
        className={`mt-1 font-mono-bold text-xl tabular-nums ${
          accent ? 'text-[var(--pyre-red)]' : 'text-[var(--pyre-creme)]'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * Health summary rendered above the execution log table. Day-level trends come
 * from durable Redis counters (survive the 14-day execution TTL); the 24h
 * cards and failure list come from the live execution records.
 */
export function WebhookHealthPanel({ refreshSignal }: { refreshSignal: number }) {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<number>(30);

  const fetchStats = useCallback(async (currentDays: number) => {
    try {
      const res = await fetch(`/api/admin/webhook-stats?days=${currentDays}`);
      if (!res.ok) {
        setError(`Failed to fetch stats (${res.status})`);
        return;
      }
      setData(await res.json());
      setError(null);
    } catch {
      setError('Network error');
    }
  }, []);

  useEffect(() => {
    fetchStats(days);
  }, [days, refreshSignal, fetchStats]);

  if (error) {
    return (
      <div className="mb-6 p-3 bg-red-900/20 border border-red-900/40 rounded text-sm text-[var(--pyre-red)]">
        Health stats unavailable: {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mb-6 h-24 rounded-lg border border-white/10 bg-white/5 animate-pulse" />
    );
  }

  const { last24h, recentFailures } = data;
  const maxDayTotal = Math.max(1, ...data.days.map((d) => d.total));

  // Aggregate the per-day event-type counters over the selected range.
  const byEventType = new Map<string, { total: number; errors: number }>();
  for (const day of data.days) {
    for (const [eventType, counts] of Object.entries(day.byEventType)) {
      const entry = byEventType.get(eventType) ?? { total: 0, errors: 0 };
      entry.total += counts.total;
      entry.errors += counts.errors;
      byEventType.set(eventType, entry);
    }
  }
  const eventTypeRows = [...byEventType.entries()].sort((a, b) => b[1].total - a[1].total);

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-mono-bold text-sm uppercase tracking-wide text-[var(--pyre-creme)]">
          Health
        </h2>
        <div className="flex gap-1">
          {DAY_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setDays(option)}
              className={`px-2.5 py-1 rounded text-xs font-mono-bold transition-colors ${
                days === option
                  ? 'bg-white/15 text-[var(--pyre-creme)]'
                  : 'text-white/40 hover:text-white/70'
              }`}
            >
              {option}d
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Last 24h" value={String(last24h.total)} />
        <StatCard
          label="Error rate (24h)"
          value={`${(last24h.errorRate * 100).toFixed(1)}%`}
          accent={last24h.errors > 0}
        />
        <StatCard label="p50 duration" value={formatMs(last24h.p50DurationMs)} />
        <StatCard label="p95 duration" value={formatMs(last24h.p95DurationMs)} />
      </div>

      <div className="mt-4 rounded-lg border border-white/10 bg-white/5 px-4 py-3">
        <div className="flex items-end gap-[2px] h-16">
          {data.days.map((day) => {
            const successHeight = ((day.total - day.errors) / maxDayTotal) * 100;
            const errorHeight = (day.errors / maxDayTotal) * 100;
            return (
              <div
                key={day.date}
                className="flex-1 flex flex-col justify-end h-full min-w-[2px]"
                title={`${day.date}: ${day.total} total, ${day.errors} errors${
                  day.total > 0 ? `, avg ${formatMs(day.avgDurationMs)}` : ''
                }`}
              >
                <div
                  className="w-full bg-[var(--pyre-red)] rounded-t-[1px]"
                  style={{ height: `${errorHeight}%` }}
                />
                <div
                  className="w-full bg-[var(--pyre-sage)] opacity-70"
                  style={{ height: `${successHeight}%` }}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-white/30">
          <span>{data.days[0]?.date}</span>
          <span>daily executions (green success / red error)</span>
          <span>{data.days[data.days.length - 1]?.date}</span>
        </div>
      </div>

      {eventTypeRows.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-white/40 text-xs uppercase tracking-wider">
                <th className="px-4 py-2">Event type</th>
                <th className="px-4 py-2 text-right">Total ({days}d)</th>
                <th className="px-4 py-2 text-right">Errors</th>
              </tr>
            </thead>
            <tbody className="text-[var(--pyre-creme)]">
              {eventTypeRows.map(([eventType, counts]) => (
                <tr key={eventType} className="border-b border-white/5">
                  <td className="px-4 py-2 font-mono text-xs">{eventType}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-white/60">
                    {counts.total}
                  </td>
                  <td
                    className={`px-4 py-2 text-right tabular-nums ${
                      counts.errors > 0 ? 'text-[var(--pyre-red)]' : 'text-white/30'
                    }`}
                  >
                    {counts.errors}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {recentFailures.length > 0 && (
        <div className="mt-4 rounded-lg border border-red-900/40 bg-red-900/10 px-4 py-3">
          <div className="text-xs uppercase tracking-wider text-[var(--pyre-red)] mb-2">
            Recent failures (7d)
          </div>
          <ul className="space-y-1.5">
            {recentFailures.map((failure) => (
              <li key={failure.id} className="text-xs text-white/70">
                <span className="font-mono text-white/40">
                  {new Date(failure.timestamp).toLocaleString()}
                </span>{' '}
                <span className="font-mono">{failure.eventType}</span>
                {failure.httpStatus ? (
                  <span className="text-white/40"> · HTTP {failure.httpStatus}</span>
                ) : null}
                {failure.errorMessage && (
                  <span className="text-[var(--pyre-red)]"> — {failure.errorMessage}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

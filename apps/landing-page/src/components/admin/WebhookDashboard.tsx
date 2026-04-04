import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';

interface WebhookExecution {
  id: string;
  timestamp: number;
  eventType: string;
  requestId: string;
  source: string;
  status: 'success' | 'error';
  durationMs: number;
  payloadSummary: string;
  fullPayload: string;
  requestHeaders: string;
  errorMessage: string;
  httpStatus: number;
}

interface LogsResponse {
  records: WebhookExecution[];
  total: number;
  limit: number;
  offset: number;
}

function StatusBadge({ status, httpStatus }: { status: string; httpStatus: number }) {
  const isOk = status === 'success';
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono-bold ${
        isOk ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-[var(--pyre-red)]'
      }`}
    >
      {httpStatus}
    </span>
  );
}

function TimeAgo({ timestamp }: { timestamp: number }) {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  let label: string;
  if (mins < 1) label = 'just now';
  else if (mins < 60) label = `${mins}m ago`;
  else if (hours < 24) label = `${hours}h ago`;
  else label = `${days}d ago`;

  const full = new Date(timestamp).toLocaleString();
  return <span title={full}>{label}</span>;
}

function formatJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}

function DetailSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="text-white/40 cursor-pointer hover:text-white/60 select-none">
        {label}
        <span className="ml-1 text-xs text-white/20 group-open:hidden">+</span>
      </summary>
      <div className="mt-1">{children}</div>
    </details>
  );
}

function ExpandedRow({ record }: { record: WebhookExecution }) {
  let payload: Record<string, string> = {};
  try {
    payload = JSON.parse(record.payloadSummary);
  } catch {
    // ignore
  }

  return (
    <div className="px-4 py-3 bg-[var(--pyre-black)] border-t border-white/5 text-sm space-y-3">
      <div className="grid grid-cols-2 gap-4 max-w-lg">
        <div>
          <span className="text-white/40">Request ID</span>
          <p className="font-mono text-xs text-white/70 break-all">{record.requestId}</p>
        </div>
        <div>
          <span className="text-white/40">Duration</span>
          <p className="text-white/70">{record.durationMs}ms</p>
        </div>
        {payload.email && (
          <div>
            <span className="text-white/40">Email</span>
            <p className="text-white/70">{payload.email}</p>
          </div>
        )}
        {payload.memberId && (
          <div>
            <span className="text-white/40">Member ID</span>
            <p className="text-white/70">{payload.memberId}</p>
          </div>
        )}
        <div>
          <span className="text-white/40">Timestamp</span>
          <p className="text-white/70 text-xs">{new Date(record.timestamp).toISOString()}</p>
        </div>
      </div>

      {record.errorMessage && (
        <div>
          <span className="text-white/40">Error</span>
          <pre className="mt-1 text-xs text-[var(--pyre-red)] bg-red-900/10 rounded p-2 overflow-x-auto">
            {record.errorMessage}
          </pre>
        </div>
      )}

      {record.fullPayload && record.fullPayload !== '{}' && (
        <DetailSection label="Full Payload">
          <pre className="text-xs text-white/70 bg-white/5 rounded p-2 overflow-x-auto max-h-80 overflow-y-auto">
            {formatJson(record.fullPayload)}
          </pre>
        </DetailSection>
      )}

      {record.requestHeaders && record.requestHeaders !== '{}' && (
        <DetailSection label="Request Headers">
          <pre className="text-xs text-white/70 bg-white/5 rounded p-2 overflow-x-auto">
            {formatJson(record.requestHeaders)}
          </pre>
        </DetailSection>
      )}
    </div>
  );
}

export function WebhookDashboard() {
  const { isAuthenticated, user, loading: authLoading, login } = useAuth();

  const [data, setData] = useState<LogsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [offset, setOffset] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const limit = 50;

  const fetchLogs = useCallback(async (currentOffset: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/webhook-logs?limit=${limit}&offset=${currentOffset}`);
      if (res.status === 401) {
        setError('not_authenticated');
        return;
      }
      if (res.status === 403) {
        setError('forbidden');
        return;
      }
      if (!res.ok) {
        setError(`Failed to fetch logs (${res.status})`);
        return;
      }
      const json: LogsResponse = await res.json();
      setData(json);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchLogs(offset);
    }
  }, [isAuthenticated, offset, fetchLogs]);

  useEffect(() => {
    if (autoRefresh && isAuthenticated) {
      intervalRef.current = setInterval(() => fetchLogs(offset), 30_000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, isAuthenticated, offset, fetchLogs]);

  // Loading auth
  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[var(--pyre-red)] border-t-transparent" />
      </div>
    );
  }

  // Not authenticated
  if (!isAuthenticated || !user) {
    return (
      <div className="max-w-md mx-auto text-center py-16 px-4">
        <h1 className="font-primary-semibold text-2xl mb-4 text-[var(--pyre-creme)]">Sign In</h1>
        <p className="text-white/60 mb-6">Log in to continue.</p>
        <button
          type="button"
          onClick={() => login({ returnUrl: '/admin/webhooks' })}
          className="px-6 py-3 rounded-md font-mono-bold text-sm uppercase tracking-wide bg-[var(--pyre-red)] text-[var(--pyre-creme)] hover:opacity-90 transition-opacity"
        >
          Log In
        </button>
      </div>
    );
  }

  // Forbidden
  if (error === 'forbidden') {
    return (
      <div className="max-w-md mx-auto text-center py-16 px-4">
        <h1 className="font-primary-semibold text-2xl mb-4 text-[var(--pyre-creme)]">
          Unauthorized
        </h1>
        <p className="text-white/60">You do not have access to this page.</p>
      </div>
    );
  }

  const totalPages = data ? Math.ceil(data.total / limit) : 0;
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className="max-w-6xl mx-auto px-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-primary-semibold text-2xl text-[var(--pyre-creme)]">
          Webhook Executions
        </h1>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-white/60 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="accent-[var(--pyre-red)]"
            />
            Auto-refresh
          </label>
          <button
            type="button"
            onClick={() => fetchLogs(offset)}
            disabled={loading}
            className="px-3 py-1.5 rounded text-xs font-mono-bold uppercase tracking-wide border border-white/20 text-white/60 hover:text-white hover:border-white/40 transition-colors disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && error !== 'forbidden' && (
        <div className="mb-4 p-3 bg-red-900/20 border border-red-900/40 rounded text-sm text-[var(--pyre-red)]">
          {error}
        </div>
      )}

      {data && data.records.length === 0 && (
        <div className="text-center py-16 text-white/40">No webhook executions recorded yet.</div>
      )}

      {data && data.records.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-white/40 text-xs uppercase tracking-wider">
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Event</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Duration</th>
                </tr>
              </thead>
              <tbody className="text-[var(--pyre-creme)]">
                {data.records.map((record) => (
                  <tr key={record.id} className="group">
                    <td colSpan={5} className="p-0">
                      <button
                        type="button"
                        onClick={() => setExpandedId(expandedId === record.id ? null : record.id)}
                        className="w-full text-left hover:bg-white/5 transition-colors"
                      >
                        <div className="grid grid-cols-5 px-4 py-3 border-b border-white/5">
                          <div className="text-white/70">
                            <TimeAgo timestamp={record.timestamp} />
                          </div>
                          <div className="font-mono text-xs text-white/50">{record.source}</div>
                          <div className="font-mono text-xs">{record.eventType}</div>
                          <div>
                            <StatusBadge status={record.status} httpStatus={record.httpStatus} />
                          </div>
                          <div className="text-white/50">{record.durationMs}ms</div>
                        </div>
                      </button>
                      {expandedId === record.id && <ExpandedRow record={record} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm text-white/50">
              <span>
                {data.total} total &middot; Page {currentPage} of {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                  className="px-3 py-1 rounded border border-white/20 hover:border-white/40 disabled:opacity-30 transition-colors"
                >
                  Prev
                </button>
                <button
                  type="button"
                  disabled={offset + limit >= data.total}
                  onClick={() => setOffset(offset + limit)}
                  className="px-3 py-1 rounded border border-white/20 hover:border-white/40 disabled:opacity-30 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

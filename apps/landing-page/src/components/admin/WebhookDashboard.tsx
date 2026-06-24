import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';

interface TraceStep {
  name: string;
  startMs: number;
  durationMs: number;
  status: 'ok' | 'error';
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
}

interface WebhookExecution {
  id: string;
  timestamp: number;
  eventType: string;
  source: string;
  status: 'success' | 'error';
  durationMs: number;
  payloadSummary: string;
  fullPayload: string;
  requestHeaders: string;
  traceSteps: string | TraceStep[];
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

function formatJson(value: unknown): string {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  return String(value ?? '');
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

function parseSteps(raw: string | TraceStep[]): TraceStep[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || raw === '[]') return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// Resolve the email for the member an event is about. Prefer the email already
// extracted into the payload summary, then fall back to the email returned by
// the Momence member lookup trace step (booking events only carry a memberId).
function getMemberEmail(record: WebhookExecution): string | null {
  try {
    const summary = JSON.parse(record.payloadSummary);
    if (summary.email) return String(summary.email);
  } catch {
    // ignore
  }
  for (const step of parseSteps(record.traceSteps)) {
    if (step.name === 'Fetch Momence member' && step.output?.email) {
      return String(step.output.email);
    }
  }
  return null;
}

interface SessionInfo {
  sessionId: string;
  title: string | null;
  dateLabel: string | null;
}

// Resolve the session/event a webhook is about. Prefer the sessionId already
// extracted into the payload summary, then fall back to the full payload
// (older records predate the summary field). Display fields (title / date) come
// from the "Resolve session" trace step output, which is null when the session
// could not be resolved.
function getSessionInfo(record: WebhookExecution): SessionInfo | null {
  let sessionId: string | null = null;
  try {
    const summary = JSON.parse(record.payloadSummary);
    if (summary.sessionId) sessionId = String(summary.sessionId);
  } catch {
    // ignore
  }
  if (!sessionId) {
    try {
      const full = JSON.parse(typeof record.fullPayload === 'string' ? record.fullPayload : '{}');
      if (full.payload?.sessionId) sessionId = String(full.payload.sessionId);
    } catch {
      // ignore
    }
  }
  if (!sessionId) return null;

  let title: string | null = null;
  let dateLabel: string | null = null;
  for (const step of parseSteps(record.traceSteps)) {
    if (step.name === 'Resolve session' && step.output) {
      if (step.output.title) title = String(step.output.title);
      if (step.output.dateLabel) dateLabel = String(step.output.dateLabel);
      break;
    }
  }
  return { sessionId, title, dateLabel };
}

// The webhook dashboard runs on the same site as /events, so this is relative.
const eventHref = (id: string) => `/events?event=${encodeURIComponent(id)}`;

function TraceTimeline({
  steps: raw,
  baseTimestamp,
}: {
  steps: string | TraceStep[];
  baseTimestamp: number;
}) {
  const steps = parseSteps(raw);
  if (steps.length === 0) return null;

  return (
    <div>
      <span className="text-white/40">Trace</span>
      <div className="mt-1 space-y-1">
        {steps.map((step) => {
          const offsetMs = step.startMs - baseTimestamp;
          const isError = step.status === 'error';
          return (
            <details key={`${step.name}-${step.startMs}`} className="group">
              <summary className="flex items-center gap-2 text-xs cursor-pointer hover:bg-white/5 rounded px-2 py-1">
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${isError ? 'bg-[var(--pyre-red)]' : 'bg-green-500'}`}
                />
                <span className="text-white/70 flex-1 truncate">{step.name}</span>
                <span className="text-white/30 tabular-nums">+{offsetMs}ms</span>
                <span className="text-white/50 tabular-nums">{step.durationMs}ms</span>
              </summary>
              <div className="ml-6 mt-1 mb-2 space-y-1">
                {step.input && (
                  <pre className="text-xs text-white/50 bg-white/5 rounded p-2 overflow-x-auto">
                    {formatJson(step.input)}
                  </pre>
                )}
                {step.output && (
                  <pre className="text-xs text-green-400/70 bg-green-900/10 rounded p-2 overflow-x-auto">
                    {formatJson(step.output)}
                  </pre>
                )}
                {step.error && (
                  <pre className="text-xs text-[var(--pyre-red)] bg-red-900/10 rounded p-2 overflow-x-auto">
                    {step.error}
                  </pre>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

function ExpandedRow({ record }: { record: WebhookExecution }) {
  let payload: Record<string, string> = {};
  try {
    payload = JSON.parse(record.payloadSummary);
  } catch {
    // ignore
  }
  const session = getSessionInfo(record);

  return (
    <div className="px-4 py-3 bg-[var(--pyre-black)] border-t border-white/5 text-sm space-y-3">
      <div className="grid grid-cols-2 gap-4 max-w-lg">
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
        {session && (
          <div>
            <span className="text-white/40">Session</span>
            <p>
              <a
                href={eventHref(session.sessionId)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--pyre-red)] hover:underline"
              >
                {session.title ?? `Session ${session.sessionId}`} ↗
              </a>
            </p>
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

      <TraceTimeline steps={record.traceSteps} baseTimestamp={record.timestamp} />
    </div>
  );
}

export function WebhookDashboard() {
  const { isAuthenticated, user, loading: authLoading, login, logout } = useAuth();

  const [data, setData] = useState<LogsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
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
        <p className="text-white/60 mb-6">
          You do not have access to this page. If your session is stale, log out and sign in again.
        </p>
        <button
          type="button"
          onClick={() => logout({ returnUrl: '/admin/webhooks' })}
          className="px-6 py-3 rounded-md font-mono-bold text-sm uppercase tracking-wide bg-[var(--pyre-red)] text-[var(--pyre-creme)] hover:opacity-90 transition-opacity"
        >
          Log Out
        </button>
      </div>
    );
  }

  const lowerSearch = search.toLowerCase();
  const stringify = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v ?? ''));
  const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : 0;
  const toMs = dateTo ? new Date(`${dateTo}T23:59:59`).getTime() : Number.POSITIVE_INFINITY;
  const filtered = data?.records.filter((r) => {
    if (r.timestamp < fromMs || r.timestamp > toMs) return false;
    if (!lowerSearch) return true;
    return (
      stringify(r.eventType).toLowerCase().includes(lowerSearch) ||
      stringify(r.source).toLowerCase().includes(lowerSearch) ||
      stringify(r.payloadSummary).toLowerCase().includes(lowerSearch) ||
      stringify(r.errorMessage).toLowerCase().includes(lowerSearch) ||
      stringify(r.fullPayload).toLowerCase().includes(lowerSearch) ||
      stringify(r.traceSteps).toLowerCase().includes(lowerSearch) ||
      String(r.httpStatus).includes(lowerSearch)
    );
  });

  const totalPages = data ? Math.ceil(data.total / limit) : 0;
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className="max-w-6xl mx-auto px-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
        <div>
          <h1 className="font-primary-semibold text-2xl text-[var(--pyre-creme)]">
            Webhook Executions
          </h1>
          <p className="text-xs text-white/40 mt-1">
            Webhook events from the last 14 days. Expand a row to see the full trace, payload, and
            headers.
          </p>
        </div>
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
          <button
            type="button"
            onClick={() => logout({ returnUrl: '/admin/webhooks' })}
            className="px-3 py-1.5 rounded text-xs font-mono-bold uppercase tracking-wide border border-white/20 text-white/60 hover:text-[var(--pyre-red)] hover:border-[var(--pyre-red)] transition-colors"
          >
            Log Out
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mt-4 mb-4">
        <input
          type="text"
          placeholder="Filter by event, source, email, status..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-2 rounded bg-white/5 border border-white/10 text-sm text-[var(--pyre-creme)] placeholder-white/30 focus:outline-none focus:border-white/30"
        />
        <div className="flex gap-2 items-center">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-2 py-2 rounded bg-white/5 border border-white/10 text-xs text-[var(--pyre-creme)] focus:outline-none focus:border-white/30 [color-scheme:dark]"
          />
          <span className="text-white/30 text-xs">to</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-2 py-2 rounded bg-white/5 border border-white/10 text-xs text-[var(--pyre-creme)] focus:outline-none focus:border-white/30 [color-scheme:dark]"
          />
          {(dateFrom || dateTo) && (
            <button
              type="button"
              onClick={() => {
                setDateFrom('');
                setDateTo('');
              }}
              className="text-xs text-white/40 hover:text-white/60"
            >
              Clear
            </button>
          )}
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

      {filtered && filtered.length === 0 && data && data.records.length > 0 && (
        <div className="text-center py-8 text-white/40">No results matching "{search}"</div>
      )}

      {filtered && filtered.length > 0 && (
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
                {filtered.map((record) => {
                  const email = getMemberEmail(record);
                  const session = getSessionInfo(record);
                  return (
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
                            <div className="font-mono text-xs">
                              <div>{record.eventType}</div>
                              {email && <div className="text-white/40 truncate">{email}</div>}
                              {session && (
                                <a
                                  href={eventHref(session.sessionId)}
                                  onClick={(e) => e.stopPropagation()}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="block truncate text-[var(--pyre-red)] hover:underline"
                                >
                                  {session.title
                                    ? `${session.title}${session.dateLabel ? ` · ${session.dateLabel}` : ''}`
                                    : `Session ${session.sessionId}`}
                                </a>
                              )}
                            </div>
                            <div>
                              <StatusBadge status={record.status} httpStatus={record.httpStatus} />
                            </div>
                            <div className="text-white/50">{record.durationMs}ms</div>
                          </div>
                        </button>
                        {expandedId === record.id && <ExpandedRow record={record} />}
                      </td>
                    </tr>
                  );
                })}
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

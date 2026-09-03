// Admin review of the knowledge assistant: every question asked on
// /admin/ask, newest first, with who asked, the access the assistant had
// for them, what it searched and read (the full trail with inputs and
// results where the agent stored one, the bare tool calls on older rows),
// and the answer it gave. Reads /api/admin/knowledge-log (admin-only);
// rows are written by the agent.

import { useCallback, useEffect, useState } from 'react';
import { describeToolCall, type TrailStep } from '@/lib/knowledge/trail';
import { type PeopleNames, personName } from '@/lib/sops/names';
import { AskTrail } from './AskTrail';
import { relativizeDashboardLinks } from './SopAsk';
import { SopMarkdown } from './SopMarkdown';
import { SopPeekModal } from './SopPeekModal';

interface LogRow {
  id: string;
  session_id: string;
  turn_id: string;
  asked_by: string;
  viewer_scope: {
    role?: string;
    shiftNotes?: 'all' | 'mine' | null;
    incidents?: 'all' | 'mine' | null;
    water?: boolean;
  };
  question: string;
  answer: string | null;
  tool_calls: Array<{ tool: string; input: Record<string, unknown> }>;
  trail: TrailStep[];
  status: 'pending' | 'answered' | 'failed' | 'cancelled';
  error: string | null;
  asked_at: string;
  answered_at: string | null;
}

interface LogPayload {
  rows: LogRow[];
  hasMore: boolean;
  people: PeopleNames;
  askers: string[];
}

const selectClass =
  'px-2 py-2 rounded bg-white/5 border border-white/10 text-sm text-[var(--pyre-creme)] focus:outline-none focus:border-white/30 [&>option]:bg-[var(--pyre-black)]';

const buttonClass =
  'px-3 py-1.5 rounded border border-white/10 bg-white/5 text-xs font-mono uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white transition-colors disabled:opacity-40';

const STATUS_CLASS: Record<LogRow['status'], string> = {
  answered: 'text-[var(--pyre-sage)]',
  pending: 'text-white/50',
  failed: 'text-[var(--pyre-red)]',
  cancelled: 'text-white/50',
};

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function duration(row: LogRow): string | null {
  if (!row.answered_at) return null;
  const ms = Date.parse(row.answered_at) - Date.parse(row.asked_at);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** One line on what the assistant was allowed to read for this question. */
export function describeScope(scope: LogRow['viewer_scope']): string {
  const log = (value: 'all' | 'mine' | null | undefined) =>
    value === 'all' ? 'all' : value === 'mine' ? 'own' : 'none';
  return [
    `SOPs as ${scope.role ?? 'staff'}`,
    `shift notes: ${log(scope.shiftNotes)}`,
    `incidents: ${log(scope.incidents)}`,
    `water log: ${scope.water ? 'yes' : 'no'}`,
  ].join(' · ');
}

async function readError(res: Response): Promise<string> {
  try {
    return ((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export function KnowledgeLog() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [people, setPeople] = useState<PeopleNames>({});
  const [askers, setAskers] = useState<string[]>([]);
  const [asker, setAsker] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [trailOpen, setTrailOpen] = useState<Set<string>>(new Set());
  const [peekSlug, setPeekSlug] = useState<string | null>(null);

  const load = useCallback(async (filter: string, before?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filter) params.set('asker', filter);
      if (before) params.set('before', before);
      const res = await fetch(`/api/admin/knowledge-log?${params}`);
      if (!res.ok) throw new Error(await readError(res));
      const payload = (await res.json()) as LogPayload;
      setRows((prev) => (before ? [...prev, ...payload.rows] : payload.rows));
      setPeople((prev) => ({ ...prev, ...payload.people }));
      setAskers(payload.askers);
      setHasMore(payload.hasMore);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the log');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(asker);
  }, [asker, load]);

  const toggleIn = (setter: typeof setOpen, id: string) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggle = (id: string) => toggleIn(setOpen, id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-white/70">
          Asked by
          <select
            className={selectClass}
            value={asker}
            onChange={(e) => setAsker(e.target.value)}
            aria-label="Filter by person"
          >
            <option value="">Everyone</option>
            {askers.map((email) => (
              <option key={email} value={email}>
                {personName(email, people)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={buttonClass}
          disabled={loading}
          onClick={() => void load(asker)}
        >
          Refresh
        </button>
        <span className="text-xs text-white/40">
          Each row is one question. Open it for the answer, what the assistant looked at, and the
          access it had for that person.
        </span>
      </div>

      {error && (
        <p className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-2 text-sm text-[var(--pyre-red)]">
          {error}
        </p>
      )}

      {!loading && rows.length === 0 && !error && (
        <p className="text-sm text-white/50">No questions yet.</p>
      )}

      <ol className="space-y-3">
        {rows.map((row) => {
          const expanded = open.has(row.id);
          const took = duration(row);
          return (
            <li key={row.id} className="rounded border border-white/10 bg-white/5">
              <button
                type="button"
                className="flex w-full flex-col gap-1 px-4 py-3 text-left"
                onClick={() => toggle(row.id)}
                aria-expanded={expanded}
              >
                <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-wide text-white/50">
                  <span>{when(row.asked_at)}</span>
                  <span className="text-[var(--pyre-creme)]">
                    {personName(row.asked_by || 'unknown', people)}
                  </span>
                  <span className={STATUS_CLASS[row.status]}>{row.status}</span>
                  {took && <span>{took}</span>}
                  <span>
                    {row.tool_calls.length} tool {row.tool_calls.length === 1 ? 'call' : 'calls'}
                  </span>
                </span>
                <span className="text-sm text-[var(--pyre-creme)]">
                  {row.question || <span className="text-white/40">(question not recorded)</span>}
                </span>
              </button>

              {expanded && (
                <div className="space-y-4 border-t border-white/10 px-4 py-3">
                  <p className="font-mono text-[11px] uppercase tracking-wide text-white/40">
                    Access: {describeScope(row.viewer_scope)}
                  </p>

                  {row.trail.length > 0 ? (
                    <div>
                      <h3 className="mb-1 font-mono text-[11px] uppercase tracking-wide text-[var(--pyre-gold)]">
                        What it did
                      </h3>
                      <AskTrail
                        steps={row.trail}
                        live={false}
                        open={trailOpen.has(row.id)}
                        onToggle={() => toggleIn(setTrailOpen, row.id)}
                      />
                    </div>
                  ) : (
                    row.tool_calls.length > 0 && (
                      <div>
                        <h3 className="mb-1 font-mono text-[11px] uppercase tracking-wide text-[var(--pyre-gold)]">
                          What it looked at
                        </h3>
                        <ol className="space-y-0.5 text-sm text-white/70">
                          {row.tool_calls.map((call, i) => (
                            // biome-ignore lint/suspicious/noArrayIndexKey: calls are positional
                            <li key={i}>{describeToolCall(call)}</li>
                          ))}
                        </ol>
                      </div>
                    )
                  )}

                  <div>
                    <h3 className="mb-1 font-mono text-[11px] uppercase tracking-wide text-[var(--pyre-gold)]">
                      Answer
                    </h3>
                    {row.answer ? (
                      <div className="text-sm">
                        <SopMarkdown
                          content={relativizeDashboardLinks(row.answer)}
                          onSopLink={setPeekSlug}
                        />
                      </div>
                    ) : (
                      <p className="text-sm text-white/40">
                        {row.status === 'pending' ? 'Still answering.' : 'No answer recorded.'}
                      </p>
                    )}
                    {row.error && (
                      <p className="mt-2 text-sm text-[var(--pyre-red)]">{row.error}</p>
                    )}
                  </div>

                  <p className="font-mono text-[10px] text-white/30">
                    session {row.session_id} · turn {row.turn_id}
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {hasMore && (
        <button
          type="button"
          className={buttonClass}
          disabled={loading}
          onClick={() => void load(asker, rows[rows.length - 1]?.asked_at)}
        >
          Load older
        </button>
      )}

      {peekSlug && <SopPeekModal slug={peekSlug} onClose={() => setPeekSlug(null)} />}
    </div>
  );
}

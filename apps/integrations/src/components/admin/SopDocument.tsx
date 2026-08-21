// Single SOP document for /admin/sops/[slug]: rendered markdown with an edit
// mode (textarea + live preview + change note), a version history panel
// (who/when/what per save, line diffs against the previous version, restore),
// and admin-only settings (access levels, category, archive, delete). Every
// save is optimistic-locked on the version the editor opened, so simultaneous
// edits surface as a reload prompt instead of a silent overwrite. The API
// enforces the real guards — this island just mirrors them.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SopRow, SopRunCheckRow, SopRunRow, SopVersionRow } from '@/lib/db';
import { countTasks, parseChecklist } from '@/lib/sops/checklist';
import { diffLines, diffSummary } from '@/lib/sops/diff';
import { ACCESS_LABELS, SOP_ACCESS_LEVELS, type SopRole } from '@/lib/sops/levels';
import { type PeopleNames, personName } from '@/lib/sops/names';
import { MIN_QUERY_LENGTH, searchContent } from '@/lib/sops/search';
import { SopMarkdown } from './SopMarkdown';
import { type RunEntry, RunsList } from './SopRunsList';

interface DocResponse {
  sop: SopRow;
  versions: SopVersionRow[];
  role: SopRole;
  canEdit: boolean;
  /** Roster names for the emails stored on versions, runs and checks. */
  people?: PeopleNames;
}

const inputClass =
  'px-3 py-2 rounded bg-white/5 border border-white/10 text-sm text-[var(--pyre-creme)] placeholder-white/30 focus:outline-none focus:border-white/30';

const buttonClass =
  'px-3 py-1.5 rounded border border-white/10 bg-white/5 text-xs font-mono uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white transition-colors disabled:opacity-40';

const primaryButtonClass =
  'px-3 py-1.5 rounded border border-[var(--pyre-gold)]/50 bg-[var(--pyre-gold)]/10 text-xs font-mono uppercase tracking-wide text-[var(--pyre-gold)] hover:border-[var(--pyre-gold)] transition-colors disabled:opacity-40';

const selectClass =
  'px-2 py-1.5 rounded bg-white/5 border border-white/10 text-sm text-[var(--pyre-creme)] focus:outline-none focus:border-white/30 [&>option]:bg-[var(--pyre-black)]';

async function readError(res: Response): Promise<string> {
  try {
    return ((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function editorLabel(email: string, people?: PeopleNames): string {
  return email === 'seed' ? 'initial import' : personName(email, people);
}

/** Line diff of one version against its predecessor (empty for v1). */
function VersionDiff({ version, previous }: { version: SopVersionRow; previous?: SopVersionRow }) {
  const lines = useMemo(
    () => diffLines(previous?.content_md ?? '', version.content_md),
    [version, previous]
  );
  return (
    <pre className="mt-2 max-h-96 overflow-auto rounded border border-white/10 bg-black/30 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
      {lines.map((line, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are positional
          key={i}
          className={
            line.kind === 'added'
              ? 'bg-[var(--pyre-sage)]/15 text-[var(--pyre-sage)]'
              : line.kind === 'removed'
                ? 'bg-[var(--pyre-red)]/15 text-[var(--pyre-red)] line-through decoration-[var(--pyre-red)]/40'
                : 'text-white/50'
          }
        >
          {line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '− ' : '  '}
          {line.text || ' '}
        </div>
      ))}
    </pre>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Indent per nesting depth (matches the parser's 2-spaces-per-level).
const DEPTH_PAD = ['', 'pl-7', 'pl-14', 'pl-21'];

/**
 * The live checklist: the document's prose rendered as usual, its task items
 * as real checkboxes bound to the shared run — each checked item shows who
 * ticked it and when.
 */
function RunView({
  runData,
  people,
  currentVersion,
  busy,
  onToggle,
  onFinish,
  onExit,
}: {
  runData: { run: SopRunRow; checks: SopRunCheckRow[]; content: string };
  people?: PeopleNames;
  currentVersion: number;
  busy: boolean;
  onToggle: (itemIndex: number, itemText: string, checked: boolean) => void;
  onFinish: (action: 'complete' | 'abandon') => void;
  onExit: () => void;
}) {
  const { run, checks, content } = runData;
  const parsed = useMemo(() => parseChecklist(content), [content]);
  const checkByIndex = useMemo(() => new Map(checks.map((c) => [c.item_index, c])), [checks]);
  const done = checks.length;
  const total = run.task_count;

  return (
    <div className="space-y-4">
      <div className="sticky top-14 z-30 space-y-2 rounded border border-[var(--pyre-gold)]/40 bg-[var(--pyre-black)] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-xs uppercase tracking-wide text-[var(--pyre-gold)]">
            Checklist in progress
          </span>
          <span className="font-mono text-xs text-white/60">
            {done}/{total} done
          </span>
          <span className="font-mono text-[10px] text-white/40">
            started by {personName(run.started_by, people)} at {formatTime(run.started_at)}
          </span>
          <span className="ml-auto flex gap-2">
            <button
              type="button"
              className={primaryButtonClass}
              disabled={busy}
              onClick={() => onFinish('complete')}
            >
              Finish
            </button>
            <button type="button" className={buttonClass} disabled={busy} onClick={onExit}>
              Exit (keep running)
            </button>
            <button
              type="button"
              className="rounded border border-white/10 px-2 py-1.5 font-mono text-[10px] uppercase tracking-wide text-white/40 hover:text-[var(--pyre-red)] disabled:opacity-40"
              disabled={busy}
              onClick={() => onFinish('abandon')}
            >
              Abandon
            </button>
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded bg-white/10">
          <div
            className="h-full bg-[var(--pyre-gold)] transition-all"
            style={{ width: `${total > 0 ? Math.round((done / total) * 100) : 0}%` }}
          />
        </div>
        {run.sop_version !== currentVersion && (
          <p className="font-mono text-[10px] text-white/40">
            Showing v{run.sop_version}, the version this run started with (the document has since
            changed).
          </p>
        )}
      </div>

      <div className="rounded border border-white/10 bg-white/5 p-5 sm:p-6">
        {parsed.segments.map((segment) => {
          if (segment.kind === 'markdown') {
            return <SopMarkdown key={`md-${segment.line}`} content={segment.content} />;
          }
          const { task } = segment;
          const check = checkByIndex.get(task.index);
          return (
            <div key={`task-${segment.line}`} className={`py-1 ${DEPTH_PAD[task.depth] ?? ''}`}>
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--pyre-gold)]"
                  checked={!!check}
                  disabled={busy}
                  onChange={(e) => onToggle(task.index, task.text, e.target.checked)}
                />
                <div
                  className={`text-sm [&_p]:my-0 ${check ? 'text-white/40 line-through' : 'text-white/80'}`}
                >
                  <SopMarkdown content={task.text} />
                </div>
              </label>
              {check && (
                <p className="mt-0.5 pl-8 font-mono text-[10px] text-[var(--pyre-sage)]">
                  ✓ {personName(check.checked_by, people)} · {formatTime(check.checked_at)}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SopDocument({ slug }: { slug: string }) {
  const [data, setData] = useState<DocResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [mode, setMode] = useState<'view' | 'edit' | 'run'>('view');
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Past runs of this document: all of them for admins, the caller's own for
  // everyone else (the API scopes; see /api/admin/sop-runs). Fetched fresh
  // each time the panel opens.
  const [showRuns, setShowRuns] = useState(false);
  const [runsPanel, setRunsPanel] = useState<RunEntry[] | null>(null);

  const deletePanelRun = async (run: RunEntry) => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/sop-runs?id=${run.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await readError(res));
      setRunsPanel((prev) => prev?.filter((r) => r.id !== run.id) ?? null);
      // Deleting the in-progress run also clears the Resume state.
      if (runData?.run.id === run.id) setRunData(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete the run');
    }
  };

  const toggleRunsPanel = async (sopId: string) => {
    if (showRuns) {
      setShowRuns(false);
      return;
    }
    setShowRuns(true);
    setRunsPanel(null);
    try {
      const res = await fetch(`/api/admin/sop-runs?view=list&sopId=${sopId}`);
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json()) as { runs: RunEntry[]; people?: PeopleNames };
      setRunsPanel(body.runs);
      setRunPeople((prev) => ({ ...prev, ...body.people }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load runs');
      setShowRuns(false);
    }
  };

  // Editor drafts (seeded from the loaded document when editing starts).
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const [preview, setPreview] = useState(false);

  const [expandedVersion, setExpandedVersion] = useState<number | null>(null);

  // In-document search: highlights every match in the rendered markdown and
  // scrolls the first one into view. Seeded from ?q= when arriving from a
  // library search result.
  const [docQuery, setDocQuery] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q');
    if (q) setDocQuery(q);
  }, []);

  const docTerm = docQuery.trim();
  const docMatches = useMemo(() => {
    if (!data || docTerm.length < MIN_QUERY_LENGTH) return null;
    return searchContent(data.sop.content_md, docTerm, 0).count;
  }, [data, docTerm]);

  // Checklist run state: the in-progress run for this document (shared — two
  // people splitting a checklist see the same run), its checks, and the
  // document snapshot it pinned at start.
  const [runData, setRunData] = useState<{
    run: SopRunRow;
    checks: SopRunCheckRow[];
    content: string;
  } | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  // Names for the people the run responses name (starters, checkers) — the
  // document response only knows its editors, so the two merge for rendering.
  const [runPeople, setRunPeople] = useState<PeopleNames>({});

  const taskCount = useMemo(() => (data ? countTasks(data.sop.content_md) : 0), [data]);

  // Look up an already-in-progress run so the toolbar can offer Resume.
  useEffect(() => {
    if (!data || taskCount === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/admin/sop-runs?sopId=${data.sop.id}`);
        if (!res.ok) return;
        const body = (await res.json()) as {
          run: SopRunRow | null;
          checks?: SopRunCheckRow[];
          content?: string;
          people?: PeopleNames;
        };
        if (!cancelled && body.run) {
          setRunData({ run: body.run, checks: body.checks ?? [], content: body.content ?? '' });
          setRunPeople((prev) => ({ ...prev, ...body.people }));
        }
      } catch {
        // Non-fatal: the doc renders fine without run state.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data, taskCount]);

  const startRun = async () => {
    if (!data) return;
    setRunBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/sop-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sopId: data.sop.id }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json()) as {
        run: SopRunRow;
        checks: SopRunCheckRow[];
        content: string;
        resumed: boolean;
        people?: PeopleNames;
      };
      setRunData({ run: body.run, checks: body.checks, content: body.content });
      setRunPeople((prev) => ({ ...prev, ...body.people }));
      setMode('run');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start the checklist');
    } finally {
      setRunBusy(false);
    }
  };

  const patchRun = async (payload: Record<string, unknown>) => {
    if (!runData) return null;
    const res = await fetch('/api/admin/sop-runs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: runData.run.id, ...payload }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const body = (await res.json()) as {
      run: SopRunRow;
      checks: SopRunCheckRow[];
      people?: PeopleNames;
    };
    // A teammate checking an item is the first this page hears of them.
    setRunPeople((prev) => ({ ...prev, ...body.people }));
    return body;
  };

  const toggleCheck = async (itemIndex: number, itemText: string, checked: boolean) => {
    if (!runData || runBusy) return;
    setRunBusy(true);
    setError(null);
    try {
      const body = await patchRun(
        checked ? { action: 'check', itemIndex, itemText } : { action: 'uncheck', itemIndex }
      );
      if (body) setRunData({ ...runData, run: body.run, checks: body.checks });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save the check');
    } finally {
      setRunBusy(false);
    }
  };

  const finishRun = async (action: 'complete' | 'abandon') => {
    if (!runData) return;
    const unchecked = runData.run.task_count - runData.checks.length;
    const message =
      action === 'complete'
        ? unchecked > 0
          ? `${unchecked} item${unchecked === 1 ? '' : 's'} unchecked — finish anyway? The record will show what was skipped.`
          : null
        : 'Abandon this run? It stays in the log as abandoned.';
    if (message && !window.confirm(message)) return;

    setRunBusy(true);
    setError(null);
    try {
      await patchRun({ action });
      setRunData(null);
      setMode('view');
      setNotice(action === 'complete' ? 'Checklist completed — nice work.' : 'Run abandoned.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to finish the run');
    } finally {
      setRunBusy(false);
    }
  };

  useEffect(() => {
    if (!docMatches) return;
    // Small delay so highlights render (and typing settles) before scrolling.
    const timer = setTimeout(() => {
      contentRef.current?.querySelector('mark')?.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [docMatches]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/sops?slug=${encodeURIComponent(slug)}`);
      if (!res.ok) throw new Error(await readError(res));
      setData((await res.json()) as DocResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load SOP');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = useCallback((doc: DocResponse) => {
    setDraftTitle(doc.sop.title);
    setDraftContent(doc.sop.content_md);
    setDraftNote('');
    setPreview(false);
    setMode('edit');
  }, []);

  // ?edit=1 (used by the create flow) drops straight into the editor. The
  // param is stripped after the first trigger, so re-runs are no-ops.
  useEffect(() => {
    if (!data) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('edit') === '1' && data.canEdit && mode === 'view') {
      startEdit(data);
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [data, mode, startEdit]);

  const save = async (content: string, title: string, note: string | null) => {
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/sops', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: data.sop.id,
          title,
          content,
          changeNote: note,
          baseVersion: data.sop.current_version,
        }),
      });
      if (!res.ok) throw new Error(await readError(res));
      // Full reload keeps the SSR page header in sync after a rename.
      window.location.href = window.location.pathname;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
      setBusy(false);
    }
  };

  const patchSettings = async (patch: Record<string, unknown>) => {
    if (!data) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/sops', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: data.sop.id, ...patch }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const { sop } = (await res.json()) as { sop: SopRow };
      setData({ ...data, sop });
      setNotice('Settings saved');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update settings');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!data) return;
    if (
      !window.confirm(
        `Permanently delete "${data.sop.title}" and its entire version history? This cannot be undone.`
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/sops?id=${data.sop.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await readError(res));
      window.location.href = '/admin/sops';
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
      setBusy(false);
    }
  };

  if (loading) return <p className="font-mono text-xs text-white/40">Loading…</p>;

  if (!data) {
    return (
      <div className="space-y-4">
        <p className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-2 text-sm text-[var(--pyre-red)]">
          {error ?? 'SOP not found'}
        </p>
        <a href="/admin/sops" className={buttonClass}>
          ← All SOPs
        </a>
      </div>
    );
  }

  const { sop, versions, role, canEdit } = data;
  // Editors (from the document) plus run participants (from the run fetches).
  const people = { ...data.people, ...runPeople };
  const isAdmin = role === 'admin';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <a href="/admin/sops" className={buttonClass}>
          ← All SOPs
        </a>
        {mode === 'view' && taskCount > 0 && !sop.archived && (
          <button
            type="button"
            className={primaryButtonClass}
            disabled={runBusy}
            onClick={() => {
              if (runData) setMode('run');
              else void startRun();
            }}
          >
            {runData
              ? `Resume checklist (${runData.checks.length}/${runData.run.task_count})`
              : 'Start checklist'}
          </button>
        )}
        {mode === 'view' && canEdit && !sop.archived && (
          <button type="button" className={buttonClass} onClick={() => startEdit(data)}>
            Edit
          </button>
        )}
        <button type="button" className={buttonClass} onClick={() => setShowHistory((v) => !v)}>
          History ({versions.length})
        </button>
        {taskCount > 0 && (
          <button
            type="button"
            className={buttonClass}
            onClick={() => void toggleRunsPanel(sop.id)}
          >
            Runs
          </button>
        )}
        {isAdmin && (
          <button type="button" className={buttonClass} onClick={() => setShowSettings((v) => !v)}>
            Settings
          </button>
        )}
        <span className="ml-auto font-mono text-[10px] text-white/40">
          v{sop.current_version} · {sop.category} · updated {formatWhen(sop.updated_at)}
          {sop.updated_by ? ` by ${editorLabel(sop.updated_by, people)}` : ''}
        </span>
      </div>

      {sop.archived && (
        <p className="rounded border border-white/20 bg-white/5 px-3 py-2 font-mono text-xs uppercase tracking-wide text-white/60">
          Archived — hidden from non-admins
        </p>
      )}

      {error && (
        <p className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-2 text-sm text-[var(--pyre-red)]">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded border border-[var(--pyre-sage)]/40 bg-[var(--pyre-sage)]/10 px-3 py-2 text-sm text-[var(--pyre-sage)]">
          {notice}
        </p>
      )}

      {showSettings && isAdmin && (
        <div className="space-y-3 rounded border border-white/10 bg-white/5 p-4">
          <h2 className="font-mono text-xs uppercase tracking-wide text-white/40">Settings</h2>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 font-mono text-xs text-white/60">
              who can view
              <select
                className={selectClass}
                value={sop.view_access}
                disabled={busy}
                onChange={(e) => void patchSettings({ viewAccess: e.target.value })}
              >
                {SOP_ACCESS_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {ACCESS_LABELS[l]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 font-mono text-xs text-white/60">
              who can edit
              <select
                className={selectClass}
                value={sop.edit_access}
                disabled={busy}
                onChange={(e) => void patchSettings({ editAccess: e.target.value })}
              >
                {SOP_ACCESS_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {ACCESS_LABELS[l]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 font-mono text-xs text-white/60">
              category
              <input
                className={`${inputClass} w-36 py-1.5`}
                defaultValue={sop.category}
                disabled={busy}
                onBlur={(e) => {
                  const value = e.target.value.trim();
                  if (value && value !== sop.category) void patchSettings({ category: value });
                }}
              />
            </label>
            <label className="flex items-center gap-2 font-mono text-xs text-white/60">
              sort
              <input
                type="number"
                className={`${inputClass} w-20 py-1.5`}
                defaultValue={sop.sort_order}
                disabled={busy}
                onBlur={(e) => {
                  const value = Number.parseInt(e.target.value, 10);
                  if (Number.isInteger(value) && value !== sop.sort_order) {
                    void patchSettings({ sortOrder: value });
                  }
                }}
              />
            </label>
          </div>
          <p className="font-mono text-[10px] text-white/40">
            View: minimum role that sees this SOP in the library (admins always do). Edit: minimum
            role that can save changes. Everyone here also needs the SOPs page grant from People.
          </p>
          <div className="flex gap-2 border-t border-white/10 pt-3">
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => void patchSettings({ archived: !sop.archived })}
            >
              {sop.archived ? 'Unarchive' : 'Archive'}
            </button>
            {sop.archived && (
              <button
                type="button"
                className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-[var(--pyre-red)] transition-colors hover:border-[var(--pyre-red)] disabled:opacity-40"
                disabled={busy}
                onClick={() => void remove()}
              >
                Delete permanently
              </button>
            )}
          </div>
        </div>
      )}

      {showRuns && (
        <div className="space-y-2 rounded border border-white/10 bg-white/5 p-4">
          <h2 className="font-mono text-xs uppercase tracking-wide text-white/40">
            Runs of this SOP{isAdmin ? '' : ' (yours)'}
          </h2>
          {runsPanel === null ? (
            <p className="font-mono text-xs text-white/40">Loading…</p>
          ) : (
            <RunsList
              runs={runsPanel}
              people={people}
              showSopTitle={false}
              onDelete={isAdmin ? (run) => void deletePanelRun(run) : undefined}
            />
          )}
        </div>
      )}

      {showHistory && (
        <div className="space-y-2 rounded border border-white/10 bg-white/5 p-4">
          <h2 className="font-mono text-xs uppercase tracking-wide text-white/40">
            Version history
          </h2>
          <ul className="divide-y divide-white/5">
            {versions.map((v, i) => {
              const previous = versions[i + 1];
              const summary = diffSummary(previous?.content_md ?? '', v.content_md);
              const expanded = expandedVersion === v.version;
              return (
                <li key={v.id} className="py-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-xs text-[var(--pyre-creme)]">v{v.version}</span>
                    <span className="text-sm text-white/70">
                      {editorLabel(v.edited_by, people)}
                    </span>
                    <span className="font-mono text-[10px] text-white/40">
                      {formatWhen(v.created_at)}
                    </span>
                    {summary && (
                      <span className="font-mono text-[10px] text-white/40">{summary}</span>
                    )}
                    {v.change_note && (
                      <span className="text-xs text-white/60 italic">“{v.change_note}”</span>
                    )}
                    <span className="ml-auto flex gap-2">
                      <button
                        type="button"
                        className="font-mono text-[10px] uppercase tracking-wide text-white/50 underline hover:text-white"
                        onClick={() => setExpandedVersion(expanded ? null : v.version)}
                      >
                        {expanded ? 'hide' : 'changes'}
                      </button>
                      {canEdit && v.version !== sop.current_version && (
                        <button
                          type="button"
                          className="font-mono text-[10px] uppercase tracking-wide text-[var(--pyre-gold)] underline hover:text-white disabled:opacity-40"
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Restore v${v.version}? The current version stays in history.`
                              )
                            ) {
                              void save(v.content_md, v.title, `Restored from v${v.version}`);
                            }
                          }}
                        >
                          restore
                        </button>
                      )}
                    </span>
                  </div>
                  {expanded && <VersionDiff version={v} previous={previous} />}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {mode === 'run' && runData ? (
        <RunView
          runData={runData}
          people={people}
          currentVersion={sop.current_version}
          busy={runBusy}
          onToggle={toggleCheck}
          onFinish={finishRun}
          onExit={() => setMode('view')}
        />
      ) : mode === 'view' ? (
        <>
          <div className="flex items-center gap-3">
            <input
              type="search"
              className={`${inputClass} w-full sm:max-w-xs`}
              placeholder="Search this SOP…"
              value={docQuery}
              onChange={(e) => setDocQuery(e.target.value)}
              aria-label="Search within this SOP"
            />
            {docMatches !== null && (
              <span className="shrink-0 font-mono text-[10px] text-white/40">
                {docMatches} match{docMatches === 1 ? '' : 'es'}
              </span>
            )}
          </div>
          <div ref={contentRef} className="rounded border border-white/10 bg-white/5 p-5 sm:p-6">
            <SopMarkdown content={sop.content_md} highlight={docTerm} />
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <input
            className={`${inputClass} w-full text-base`}
            value={draftTitle}
            disabled={busy}
            onChange={(e) => setDraftTitle(e.target.value)}
            placeholder="Title"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`${buttonClass} ${!preview ? 'border-white/40 text-white' : ''}`}
              onClick={() => setPreview(false)}
            >
              Write
            </button>
            <button
              type="button"
              className={`${buttonClass} ${preview ? 'border-white/40 text-white' : ''}`}
              onClick={() => setPreview(true)}
            >
              Preview
            </button>
            <span className="ml-auto font-mono text-[10px] text-white/40">
              Markdown — use “- [ ]” for checklist items
            </span>
          </div>
          {preview ? (
            <div className="min-h-[50vh] rounded border border-white/10 bg-white/5 p-5">
              <SopMarkdown content={draftContent} />
            </div>
          ) : (
            <textarea
              className={`${inputClass} min-h-[50vh] w-full resize-y font-mono text-xs leading-relaxed`}
              value={draftContent}
              disabled={busy}
              onChange={(e) => setDraftContent(e.target.value)}
              spellCheck={false}
            />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`${inputClass} min-w-64 flex-1`}
              value={draftNote}
              disabled={busy}
              onChange={(e) => setDraftNote(e.target.value)}
              placeholder="What changed? (optional, shown in history)"
              maxLength={300}
            />
            <button
              type="button"
              className={primaryButtonClass}
              disabled={busy || !draftTitle.trim()}
              onClick={() => void save(draftContent, draftTitle.trim(), draftNote.trim() || null)}
            >
              Save v{sop.current_version + 1}
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => setMode('view')}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

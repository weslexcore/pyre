// Single SOP document for /admin/sops/[slug]: rendered markdown with an edit
// mode (textarea + live preview + change note), a version history panel
// (who/when/what per save, line diffs against the previous version, restore),
// and admin-only settings (access levels, category, archive, delete). Every
// save is optimistic-locked on the version the editor opened, so simultaneous
// edits surface as a reload prompt instead of a silent overwrite. The API
// enforces the real guards — this island just mirrors them.
//
// Task-bearing documents render as a live checklist (ChecklistView): there is
// no separate run mode — checking the first item starts the shared run,
// unchecking the last one silently discards it, and links to other library
// documents open in a peek modal (SopPeekModal) so a tutorial never navigates
// away from a half-finished checklist.
//
// The page arrives with the document and its open run already rendered
// (`initial`, assembled server-side by lib/sops/document.ts), so nothing is
// fetched on mount. Taps apply locally first and reach the server through a
// serialized queue — the box flips instantly, the record catches up behind
// it, and a refused tap is rolled back with an error.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import type { SopRow, SopRunCheckRow, SopRunRow, SopVersionRow } from '@/lib/db';
import { countTasks } from '@/lib/sops/checklist';
import { diffLines, diffSummary } from '@/lib/sops/diff';
import type { SopDocumentPayload } from '@/lib/sops/document';
import { EVERYONE_LABEL } from '@/lib/sops/levels';
import { type PeopleNames, personName } from '@/lib/sops/names';
import {
  applyCheck,
  applyUncheck,
  type CheckItems,
  isPersisted,
  pendingRun,
  type RunState,
  revertCheck,
  revertUncheck,
} from '@/lib/sops/optimistic';
import { MIN_QUERY_LENGTH, searchContent } from '@/lib/sops/search';
import { ChecklistView } from './ChecklistView';
import { ConfirmDialog } from './ConfirmDialog';
import { SopAccessPicker, withAdmins } from './SopAccessPicker';
import { SopLinkTextarea } from './SopLinkTextarea';
import { SopMarkdown } from './SopMarkdown';
import { SopPeekModal } from './SopPeekModal';
import { type RunEntry, RunsList } from './SopRunsList';

type DocResponse = SopDocumentPayload;

interface VersionsResponse {
  versions: SopVersionRow[];
  people?: PeopleNames;
}

/** What the runs API answers with after a start, check, or lookup. */
interface RunResponse {
  run: SopRunRow | null;
  checks?: SopRunCheckRow[];
  content?: string;
  people?: PeopleNames;
}

// Server-rendered HTML older than this (a prefetched page, a bfcache restore)
// re-checks the shared run in the background once the island is up.
const FRESH_MS = 15_000;

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

// Pinned locale + venue time zone: this renders on the server and again on
// the phone, and the two have to agree or React throws the server tree away.
function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
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

export function SopDocument({
  slug,
  initial,
  initialError = null,
}: {
  slug: string;
  /** The document as the page loaded it; null when it couldn't. */
  initial: DocResponse | null;
  initialError?: string | null;
}) {
  const [data, setData] = useState<DocResponse | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [mode, setMode] = useState<'view' | 'edit'>('view');
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
      // Deleting the in-progress run also clears the checklist.
      if (runRef.current?.run.id === run.id) {
        commit(null);
        lastRunRef.current = null;
      }
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
  // document snapshot it pinned at start. Seeded from the server-rendered
  // payload, then owned here: taps apply locally first and the server hears
  // about them through a serialized queue (helpers in lib/sops/optimistic).
  const [runData, setRunData] = useState<RunState | null>(initial?.run ?? null);
  // Mirror for the queue: an op must see the state the taps before it left,
  // not the render it was created in.
  const runRef = useRef<RunState | null>(initial?.run ?? null);
  // The last state that held a run — after an optimistic "nothing checked,
  // run gone" the queued uncheck still needs the run's id.
  const lastRunRef = useRef<RunState | null>(initial?.run ?? null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  // Requests still in flight or waiting their turn.
  const [pending, setPending] = useState(0);
  const pendingRef = useRef(0);
  // Finish/Discard in flight — those still wait for the server.
  const [runBusy, setRunBusy] = useState(false);
  // Names for the people the run responses name (starters, checkers) — the
  // document response only knows its editors, so the two merge for rendering.
  const [runPeople, setRunPeople] = useState<PeopleNames>({});

  // Which finish action is awaiting confirmation in the dialog, if any.
  const [confirmAction, setConfirmAction] = useState<'complete' | 'discard' | null>(null);

  // Library document opened in the peek modal from an in-content link.
  const [peekSlug, setPeekSlug] = useState<string | null>(null);

  const viewerEmail = data?.viewerEmail ?? '';
  const taskCount = useMemo(() => (data ? countTasks(data.sop.content_md) : 0), [data]);

  const commit = useCallback((next: RunState | null) => {
    runRef.current = next;
    if (next) lastRunRef.current = next;
    setRunData(next);
  }, []);

  const mergePeople = useCallback((people?: PeopleNames) => {
    if (people) setRunPeople((prev) => ({ ...prev, ...people }));
  }, []);

  const enqueue = useCallback((op: () => Promise<void>) => {
    pendingRef.current += 1;
    setPending(pendingRef.current);
    queueRef.current = queueRef.current
      .then(op)
      .catch(() => {
        // Ops report their own failures (revert + error banner).
      })
      .finally(() => {
        pendingRef.current -= 1;
        setPending(pendingRef.current);
      });
  }, []);

  // Adopt a server response. The run row is always taken (after the first
  // start it's how the real id arrives); the checks only when nothing else is
  // queued behind this op — an earlier response would otherwise erase taps
  // the server hasn't seen yet.
  const reconcile = useCallback(
    (body: RunResponse) => {
      mergePeople(body.people);
      const last = pendingRef.current === 1;
      const current = runRef.current;

      if (!body.run) {
        // The server has no run (it auto-discarded after an uncheck).
        if (!current) {
          lastRunRef.current = null;
        } else if (current.checks.length === 0) {
          commit(null);
          lastRunRef.current = null;
        } else if (isPersisted(current.run)) {
          // Taps since then re-checked items: the next op starts afresh.
          commit({ ...current, run: { ...current.run, id: '' } });
        }
        return;
      }

      if (!current) {
        // Locally nothing is checked (an uncheck is queued, or just landed).
        // Show the server's run only when it's the final word and holds a
        // teammate's checks; otherwise just remember its id for the queue.
        const adopted: RunState = {
          run: body.run,
          checks: last ? (body.checks ?? []) : [],
          content: body.content ?? lastRunRef.current?.content ?? data?.sop.content_md ?? '',
        };
        if (last && adopted.checks.length > 0) commit(adopted);
        else lastRunRef.current = adopted;
        return;
      }

      commit({
        run: body.run,
        checks: last && body.checks ? body.checks : current.checks,
        content: body.content ?? current.content,
      });
    },
    [commit, mergePeople, data]
  );

  const postStart = async (items: CheckItems): Promise<RunResponse> => {
    if (!data) throw new Error('SOP not loaded');
    const res = await fetch('/api/admin/sop-runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sopId: data.sop.id, initialChecks: items }),
    });
    if (!res.ok) throw new Error(await readError(res));
    return (await res.json()) as RunResponse;
  };

  const patchRun = async (runId: string, payload: Record<string, unknown>) => {
    const res = await fetch('/api/admin/sop-runs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, ...payload }),
    });
    if (!res.ok) throw new Error(await readError(res));
    return (await res.json()) as RunResponse;
  };

  // The queued half of a check: start the run if this screen has none yet,
  // otherwise record the items on the run it knows.
  const sendCheck = async (items: CheckItems, added: number[]) => {
    const current = runRef.current;
    if (!current || !data) return;
    try {
      if (!isPersisted(current.run)) {
        reconcile(await postStart(items));
        return;
      }
      try {
        reconcile(await patchRun(current.run.id, { action: 'check', items }));
      } catch (e) {
        // The run may have vanished under us — a teammate unchecked the last
        // item and it auto-discarded. If so, this tap becomes a fresh start.
        const probe = await fetch(`/api/admin/sop-runs?sopId=${data.sop.id}`);
        const alive = probe.ok && ((await probe.json()) as { run: SopRunRow | null }).run;
        if (alive) throw e;
        reconcile(await postStart(items));
      }
    } catch (e) {
      const now = runRef.current;
      if (now) {
        const reverted = revertCheck(now, added);
        commit(reverted.checks.length === 0 && !isPersisted(reverted.run) ? null : reverted);
      }
      setError(e instanceof Error ? e.message : 'Failed to save the check');
    }
  };

  const sendUncheck = async (itemIndex: number, removed: SopRunCheckRow) => {
    // The screen may already show no run (that was the last item); the id
    // lives on in lastRunRef. A run that never reached the server has
    // nothing to undo there.
    const known = runRef.current ?? lastRunRef.current;
    if (!known || !isPersisted(known.run)) return;
    try {
      reconcile(await patchRun(known.run.id, { action: 'uncheck', itemIndex }));
    } catch (e) {
      const base = runRef.current ?? lastRunRef.current;
      if (base) commit(revertUncheck(base, removed));
      setError(e instanceof Error ? e.message : 'Failed to save the check');
    }
  };

  // `items` carries one entry per affected task — a tap on a parent brings
  // its whole subtree along (ChecklistView computes the group). The box flips
  // now; the request queues behind whatever is already in flight.
  const toggleCheck = (items: CheckItems, checked: boolean) => {
    if (!data || items.length === 0) return;
    setError(null);
    const nowIso = new Date().toISOString();
    if (checked) {
      // With nothing on screen, prefer the run the server still knows (an
      // uncheck of the last item may be mid-flight) over a brand-new one.
      const remembered = lastRunRef.current;
      const base: RunState =
        runRef.current ??
        (remembered && isPersisted(remembered.run)
          ? { ...remembered, checks: [] }
          : {
              run: pendingRun(data.sop, taskCount, viewerEmail, nowIso),
              checks: [],
              content: data.sop.content_md,
            });
      const { next, added } = applyCheck(base, items, viewerEmail, nowIso);
      if (added.length === 0) return;
      commit(next);
      enqueue(() => sendCheck(items, added));
      return;
    }
    const current = runRef.current;
    if (!current) return;
    const { next, removed } = applyUncheck(current, items[0].itemIndex);
    if (!removed) return;
    // Unchecking the last item ends the run, as it does on the server.
    commit(next.checks.length === 0 ? null : next);
    enqueue(() => sendUncheck(items[0].itemIndex, removed));
  };

  // A finish that loses nothing (everything checked, or discarding an empty
  // run) goes straight through; anything else confirms in the dialog first.
  const requestFinish = (action: 'complete' | 'discard') => {
    if (!runData || pendingRef.current > 0) return;
    const done = runData.checks.length;
    if (action === 'complete' && done >= runData.run.task_count) {
      void finishRun(action);
      return;
    }
    if (action === 'discard' && done === 0) {
      void finishRun(action);
      return;
    }
    setConfirmAction(action);
  };

  const finishRun = async (action: 'complete' | 'discard') => {
    const current = runRef.current;
    if (!current || !isPersisted(current.run)) return;
    setConfirmAction(null);
    setRunBusy(true);
    setError(null);
    try {
      const body = await patchRun(current.run.id, { action });
      mergePeople(body.people);
      commit(null);
      lastRunRef.current = null;
      setNotice(
        action === 'complete'
          ? 'Checklist completed — nice work.'
          : 'Checklist discarded — nothing was saved.'
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to finish the run');
    } finally {
      setRunBusy(false);
    }
  };

  // The HTML this island hydrated from may be older than it looks (a
  // prefetched page, a bfcache restore): re-check the shared run once, and
  // only if no tap of ours is in flight to be clobbered.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once for the payload the page shipped with
  useEffect(() => {
    if (!initial || initial.taskCount === 0) return;
    if (Date.now() - initial.loadedAt < FRESH_MS) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/admin/sop-runs?sopId=${initial.sop.id}`);
        if (!res.ok) return;
        const body = (await res.json()) as RunResponse;
        if (cancelled || pendingRef.current > 0) return;
        mergePeople(body.people);
        if (body.run) {
          commit({ run: body.run, checks: body.checks ?? [], content: body.content ?? '' });
        } else {
          commit(null);
          lastRunRef.current = null;
        }
      } catch {
        // Non-fatal: the rendered state stands.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Version history loads when the panel opens — the bodies of every past
  // save have no place on the document's critical path.
  const versionsQuery = useCachedJson<VersionsResponse>(
    showHistory && data ? `/api/admin/sops?slug=${encodeURIComponent(slug)}&view=versions` : null,
    { maxAgeMs: 60_000 }
  );

  // Editors (from the document), run participants (from run responses), and
  // past editors (from history), merged for rendering.
  const people = useMemo(
    () => ({ ...data?.people, ...runPeople, ...versionsQuery.data?.people }),
    [data?.people, runPeople, versionsQuery.data?.people]
  );

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

  // Retry after a failed page load — the normal path never fetches here.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/sops?slug=${encodeURIComponent(slug)}`);
      if (!res.ok) throw new Error(await readError(res));
      const doc = (await res.json()) as DocResponse;
      setData(doc);
      commit(doc.run);
      if (!doc.run) lastRunRef.current = null;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load SOP');
    } finally {
      setLoading(false);
    }
  }, [slug, commit]);

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

  // The checklist is always live now, so ?run=1 (old resume links and
  // bookmarks) has nothing to switch — just strip it from the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('run') !== '1') return;
    params.delete('run');
    const query = params.toString();
    window.history.replaceState(
      null,
      '',
      query ? `${window.location.pathname}?${query}` : window.location.pathname
    );
  }, []);

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
      invalidateJson(`/api/admin/sops?slug=${encodeURIComponent(slug)}`);
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
      const body = (await res.json()) as { sop: SopRow; accessLabel?: string };
      setData({ ...data, sop: body.sop, accessLabel: body.accessLabel ?? data.accessLabel });
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
        <div className="flex gap-2">
          <a href="/admin/sops" className={buttonClass}>
            ← All SOPs
          </a>
          <button type="button" className={buttonClass} onClick={() => void load()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { sop, role, canEdit } = data;
  const versions = versionsQuery.data?.versions ?? [];
  const isAdmin = role === 'admin';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <a href="/admin/sops" className={buttonClass}>
          ← All SOPs
        </a>
        {mode === 'view' && canEdit && !sop.archived && (
          <button type="button" className={buttonClass} onClick={() => startEdit(data)}>
            Edit
          </button>
        )}
        <button type="button" className={buttonClass} onClick={() => setShowHistory((v) => !v)}>
          History ({sop.current_version})
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
          {/* Who else is reading this. Only worth saying when the document is
              narrower than the whole team. */}
          {data.accessLabel && data.accessLabel !== EVERYONE_LABEL && (
            <>
              {' · '}
              <span className="text-[var(--pyre-gold)]">
                view: {data.accessLabel.toLowerCase()}
              </span>
            </>
          )}
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

          {/* Each toggle saves on its own, like the rest of this panel — busy
              disables the controls in flight, so the changes can't race. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <SopAccessPicker
              title="Who can view"
              grant={{ roles: sop.view_roles, emails: sop.view_emails }}
              staff={data.staff ?? []}
              disabled={busy}
              onChange={(next) =>
                void patchSettings({ viewRoles: withAdmins(next.roles), viewEmails: next.emails })
              }
            />
            <SopAccessPicker
              title="Who can edit"
              hint="Anyone who can edit can also view."
              grant={{ roles: sop.edit_roles, emails: sop.edit_emails }}
              staff={data.staff ?? []}
              disabled={busy}
              onChange={(next) =>
                void patchSettings({ editRoles: withAdmins(next.roles), editEmails: next.emails })
              }
            />
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 font-mono text-xs text-white/60">
              section
              {/* Picking from the library's sections rather than retyping the
                  name — a typo here used to fork a one-document section. New
                  sections are added on the library page. */}
              <select
                className={selectClass}
                value={sop.category}
                disabled={busy}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value && value !== sop.category) void patchSettings({ category: value });
                }}
              >
                {/* The document's own section is always an option, even if the
                    list didn't load. */}
                {(data.categories?.includes(sop.category)
                  ? (data.categories ?? [])
                  : [sop.category, ...(data.categories ?? [])]
                ).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
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
          {versionsQuery.loading && <p className="font-mono text-xs text-white/40">Loading…</p>}
          {versionsQuery.error && (
            <p className="text-sm text-[var(--pyre-red)]">{versionsQuery.error}</p>
          )}
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

      {mode === 'view' ? (
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
          {taskCount > 0 && !sop.archived ? (
            // The live checklist. With a run open it renders the run's pinned
            // snapshot; otherwise the current document, ready for a first tap.
            <div ref={contentRef}>
              <ChecklistView
                content={runData?.content ?? sop.content_md}
                run={runData?.run ?? null}
                checks={runData?.checks ?? []}
                people={people}
                currentVersion={sop.current_version}
                busy={runBusy || pending > 0}
                highlight={docTerm}
                onSopLink={setPeekSlug}
                onToggle={toggleCheck}
                onFinish={() => requestFinish('complete')}
                onDiscard={() => requestFinish('discard')}
              />
            </div>
          ) : (
            <div ref={contentRef} className="rounded border border-white/10 bg-white/5 p-5 sm:p-6">
              <SopMarkdown content={sop.content_md} highlight={docTerm} onSopLink={setPeekSlug} />
            </div>
          )}
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
              Markdown — “- [ ]” for checklist items · type [name](/ to pick a page or SOP to link
            </span>
          </div>
          {preview ? (
            <div className="min-h-[50vh] rounded border border-white/10 bg-white/5 p-5">
              <SopMarkdown content={draftContent} onSopLink={setPeekSlug} />
            </div>
          ) : (
            <SopLinkTextarea
              className={`${inputClass} min-h-[50vh] w-full resize-y font-mono text-xs leading-relaxed`}
              value={draftContent}
              disabled={busy}
              onChange={setDraftContent}
              currentSlug={sop.slug}
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

      {confirmAction && runData && (
        <ConfirmDialog
          title={confirmAction === 'complete' ? 'Finish checklist?' : 'Discard checklist?'}
          body={
            confirmAction === 'complete'
              ? `${runData.run.task_count - runData.checks.length} item${
                  runData.run.task_count - runData.checks.length === 1 ? '' : 's'
                } unchecked — the record will show what was skipped.`
              : `Nothing is saved — the ${runData.checks.length} item${
                  runData.checks.length === 1 ? '' : 's'
                } already checked off will be erased.`
          }
          confirmLabel={confirmAction === 'complete' ? 'Finish' : 'Discard'}
          danger={confirmAction === 'discard'}
          busy={runBusy}
          onConfirm={() => void finishRun(confirmAction)}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {peekSlug && <SopPeekModal slug={peekSlug} onClose={() => setPeekSlug(null)} />}
    </div>
  );
}

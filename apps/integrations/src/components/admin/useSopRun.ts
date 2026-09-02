// The checklist run engine, shared by the SOP page (SopDocument) and the peek
// modal (SopPeekModal), each of which drives one document's run with its own
// instance. Holds the in-progress run for the document (shared — two people
// splitting a checklist see the same run), its checks, and the snapshot it
// pinned at start. Taps apply locally first and the server hears about them
// through a serialized queue (pure helpers in lib/sops/optimistic): the box
// flips instantly, the record catches up behind it, and a refused tap is
// rolled back with an error.
//
// A run finishes on its own when the last item is checked (the server
// completes it as the check lands); the finished run stays on screen, all
// boxes ticked, until Start again clears it. Finish is only for ending a run
// with items deliberately left unchecked.
//
// Every closure the queue runs later reads the latest options and refs at call
// time, never the render it was created in — an op must see the state the
// taps before it left, and the document as it is when the op runs.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SopRow, SopRunCheckRow, SopRunRow } from '@/lib/db';
import type { PeopleNames } from '@/lib/sops/names';
import {
  applyCheck,
  applyUncheck,
  type CheckItems,
  isPersisted,
  pendingRun,
  type RunResponseBody,
  type RunState,
  reconcileRun,
  revertCheck,
  revertUncheck,
} from '@/lib/sops/optimistic';

/** What the runs API answers with after a start, check, or lookup. */
export interface RunResponse extends RunResponseBody {
  people?: PeopleNames;
}

export type FinishAction = 'complete' | 'discard';

export interface UseSopRunOptions {
  /** The document the run belongs to; null while the page has nothing loaded. */
  sop: Pick<SopRow, 'id' | 'content_md' | 'current_version'> | null;
  taskCount: number;
  /** The session email, so optimistic checks are attributed before the server answers. */
  viewerEmail: string;
  /** Run state the payload shipped with — seeds state on first render only. */
  initialRun: RunState | null;
  /** Epoch ms the payload was assembled; older than FRESH_MS triggers one re-check. */
  loadedAt: number | null;
  /** Error banner: null clears it (every tap clears the previous error). */
  onError: (message: string | null) => void;
  onNotice: (message: string) => void;
}

export interface SopRunController {
  /** The open run, or the finished one still on screen (see isLiveRun). */
  runData: RunState | null;
  /** Requests still in flight or waiting their turn. */
  pending: number;
  /** Finish/Discard in flight — those still wait for the server. */
  runBusy: boolean;
  /** Names for the people the run responses name (starters, checkers). */
  people: PeopleNames;
  mergePeople: (people?: PeopleNames) => void;
  /** Which finish action is awaiting confirmation in the dialog, if any. */
  confirmAction: FinishAction | null;
  cancelConfirm: () => void;
  toggleCheck: (items: CheckItems, checked: boolean) => void;
  requestFinish: (action: FinishAction) => void;
  finishRun: (action: FinishAction) => Promise<void>;
  /** Clear a finished run off the screen; the next tap starts a new one. */
  startAgain: () => void;
  /** Replace the run outright (page reload, run deleted from the log). */
  resetRun: (next: RunState | null) => void;
}

/** Whether the state on screen is a run still being worked (not a finished one). */
export function isLiveRun(state: RunState | null): boolean {
  return state !== null && state.run.status === 'in_progress';
}

// Server-rendered HTML older than this (a prefetched page, a bfcache restore)
// re-checks the shared run in the background once the island is up.
const FRESH_MS = 15_000;

const COMPLETED_NOTICE = 'Checklist completed — nice work.';

export async function readError(res: Response): Promise<string> {
  try {
    return ((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

async function postStart(sopId: string, items: CheckItems): Promise<RunResponse> {
  const res = await fetch('/api/admin/sop-runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sopId, initialChecks: items }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as RunResponse;
}

async function patchRun(runId: string, payload: Record<string, unknown>): Promise<RunResponse> {
  const res = await fetch('/api/admin/sop-runs', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId, ...payload }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as RunResponse;
}

export function useSopRun(options: UseSopRunOptions): SopRunController {
  // The options as of the latest render, for closures that run later.
  const latest = useRef(options);
  latest.current = options;

  const [runData, setRunData] = useState<RunState | null>(options.initialRun);
  // Mirror for the queue: an op must see the state the taps before it left,
  // not the render it was created in.
  const runRef = useRef<RunState | null>(options.initialRun);
  // The last state that held an open run — after an optimistic "nothing
  // checked, run gone" the queued uncheck still needs the run's id. Never a
  // finished run: those take no more checks.
  const lastRunRef = useRef<RunState | null>(
    isLiveRun(options.initialRun) ? options.initialRun : null
  );
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const [pending, setPending] = useState(0);
  const pendingRef = useRef(0);
  const [runBusy, setRunBusy] = useState(false);
  const [people, setPeople] = useState<PeopleNames>({});
  const [confirmAction, setConfirmAction] = useState<FinishAction | null>(null);
  // The finished run already announced, so a second response doesn't repeat it.
  const announcedRef = useRef<string | null>(
    options.initialRun && !isLiveRun(options.initialRun) ? options.initialRun.run.id : null
  );

  const commit = useCallback((next: RunState | null) => {
    runRef.current = next;
    if (next) lastRunRef.current = isLiveRun(next) ? next : null;
    setRunData(next);
  }, []);

  const resetRun = useCallback(
    (next: RunState | null) => {
      commit(next);
      if (!next) lastRunRef.current = null;
    },
    [commit]
  );

  const startAgain = useCallback(() => resetRun(null), [resetRun]);

  const mergePeople = useCallback((names?: PeopleNames) => {
    if (names) setPeople((prev) => ({ ...prev, ...names }));
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

  // A run the server just finished (the check that filled it, or a teammate's):
  // say so once, and stop remembering it as somewhere to send checks.
  const noteFinished = useCallback((state: RunState | null) => {
    if (!state || isLiveRun(state)) return;
    lastRunRef.current = null;
    if (announcedRef.current === state.run.id) return;
    announcedRef.current = state.run.id;
    latest.current.onNotice(COMPLETED_NOTICE);
  }, []);

  // Adopt a server response (the rules live in reconcileRun). "Last queued"
  // is read here, inside the op, before enqueue's finally decrements it.
  const reconcile = useCallback(
    (body: RunResponse) => {
      mergePeople(body.people);
      const next = reconcileRun(
        { run: runRef.current, last: lastRunRef.current },
        body,
        pendingRef.current === 1,
        latest.current.sop?.content_md ?? ''
      );
      runRef.current = next.run;
      lastRunRef.current = next.last && isLiveRun(next.last) ? next.last : null;
      setRunData(next.run);
      noteFinished(next.run);
    },
    [mergePeople, noteFinished]
  );

  // The queued half of a check: start the run if this screen has none yet,
  // otherwise record the items on the run it knows.
  const sendCheck = useCallback(
    async (items: CheckItems, added: number[]) => {
      const current = runRef.current;
      const sop = latest.current.sop;
      if (!current || !sop) return;
      try {
        if (!isPersisted(current.run)) {
          reconcile(await postStart(sop.id, items));
          return;
        }
        try {
          reconcile(await patchRun(current.run.id, { action: 'check', items }));
        } catch (e) {
          // The run may have vanished under us — a teammate unchecked the last
          // item and it auto-discarded. If so, this tap becomes a fresh start.
          const probe = await fetch(`/api/admin/sop-runs?sopId=${sop.id}`);
          const alive = probe.ok && ((await probe.json()) as { run: SopRunRow | null }).run;
          if (alive) throw e;
          reconcile(await postStart(sop.id, items));
        }
      } catch (e) {
        const now = runRef.current;
        if (now) {
          const reverted = revertCheck(now, added);
          commit(reverted.checks.length === 0 && !isPersisted(reverted.run) ? null : reverted);
        }
        latest.current.onError(e instanceof Error ? e.message : 'Failed to save the check');
      }
    },
    [commit, reconcile]
  );

  const sendUncheck = useCallback(
    async (itemIndex: number, removed: SopRunCheckRow) => {
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
        latest.current.onError(e instanceof Error ? e.message : 'Failed to save the check');
      }
    },
    [commit, reconcile]
  );

  // `items` carries one entry per affected task — a tap on a parent brings
  // its whole subtree along (ChecklistView computes the group). The box flips
  // now; the request queues behind whatever is already in flight.
  const toggleCheck = useCallback(
    (items: CheckItems, checked: boolean) => {
      const { sop, taskCount, viewerEmail, onError } = latest.current;
      if (!sop || items.length === 0) return;
      // A finished run takes no taps; Start again clears it first.
      if (runRef.current && !isLiveRun(runRef.current)) return;
      onError(null);
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
                run: pendingRun(sop, taskCount, viewerEmail, nowIso),
                checks: [],
                content: sop.content_md,
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
    },
    [commit, enqueue, sendCheck, sendUncheck]
  );

  const finishRun = useCallback(
    async (action: FinishAction) => {
      const current = runRef.current;
      if (!current || !isLiveRun(current) || !isPersisted(current.run)) return;
      setConfirmAction(null);
      setRunBusy(true);
      latest.current.onError(null);
      try {
        const body = await patchRun(current.run.id, { action });
        mergePeople(body.people);
        if (action === 'complete' && body.run) {
          // The finished run stays on screen, ticked, until Start again.
          announcedRef.current = body.run.id;
          commit({
            run: body.run,
            checks: body.checks ?? current.checks,
            content: current.content,
          });
        } else {
          commit(null);
        }
        lastRunRef.current = null;
        latest.current.onNotice(
          action === 'complete' ? COMPLETED_NOTICE : 'Checklist discarded — nothing was saved.'
        );
      } catch (e) {
        latest.current.onError(e instanceof Error ? e.message : 'Failed to finish the run');
      } finally {
        setRunBusy(false);
      }
    },
    [commit, mergePeople]
  );

  // A finish that loses nothing (everything checked, or discarding an empty
  // run) goes straight through; anything else confirms in the dialog first.
  const requestFinish = useCallback(
    (action: FinishAction) => {
      const current = runRef.current;
      if (!current || !isLiveRun(current) || pendingRef.current > 0) return;
      const done = current.checks.length;
      if (action === 'complete' && done >= current.run.task_count) {
        void finishRun(action);
        return;
      }
      if (action === 'discard' && done === 0) {
        void finishRun(action);
        return;
      }
      setConfirmAction(action);
    },
    [finishRun]
  );

  const cancelConfirm = useCallback(() => setConfirmAction(null), []);

  // The HTML this island hydrated from may be older than it looks (a
  // prefetched page, a bfcache restore): re-check the shared run once, and
  // only if no tap of ours is in flight to be clobbered. A finished run on
  // screen stays — the server only answers with open ones.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once for the payload the screen shipped with
  useEffect(() => {
    const { sop, taskCount, loadedAt } = latest.current;
    if (!sop || taskCount === 0 || loadedAt === null) return;
    if (Date.now() - loadedAt < FRESH_MS) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/admin/sop-runs?sopId=${sop.id}`);
        if (!res.ok) return;
        const body = (await res.json()) as RunResponse;
        if (cancelled || pendingRef.current > 0) return;
        mergePeople(body.people);
        if (body.run) {
          commit({ run: body.run, checks: body.checks ?? [], content: body.content ?? '' });
        } else if (!runRef.current || isLiveRun(runRef.current)) {
          resetRun(null);
        }
      } catch {
        // Non-fatal: the rendered state stands.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    runData,
    pending,
    runBusy,
    people,
    mergePeople,
    confirmAction,
    cancelConfirm,
    toggleCheck,
    requestFinish,
    finishRun,
    startAgain,
    resetRun,
  };
}

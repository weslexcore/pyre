// Peek modal for in-checklist SOP links: clicking "[Clear towel hampers]
// (/admin/sops/momence-dirty-towels)" mid-run opens the tutorial here instead
// of navigating away from a half-finished checklist. Links inside the modal to
// other library documents navigate within it (a simple stack with Back);
// "Open full page" is the escape hatch for long reads. Content comes from the
// same /api/admin/sops endpoint the document page uses, so access rules hold —
// a document the viewer may not read answers 404 and shows as unavailable.
//
// A peeked document that is itself a checklist is live here, exactly as on
// its own page: the same ChecklistView bound to the document's shared run
// (useSopRun), with the progress header, Finish and Discard. Each tap reports
// the sub-checklist's progress back to the parent, which shows it under the
// item that linked here. The fetch carries the parent run's start (`since`),
// so a sub-checklist finished during this run of the parent opens showing
// its ticks rather than a blank list. Modal mechanics follow the MeasurementInfo pattern
// (backdrop button, Escape, focus on Close, bottom sheet on mobile).
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { SopDocumentPayload } from '@/lib/sops/document';
import type { LinkedProgress, LinkedProgressMap } from '@/lib/sops/links';
import type { CheckItems } from '@/lib/sops/optimistic';
import { ChecklistConfirmDialog, ChecklistView } from './ChecklistView';
import { cascadeLinked } from './linkedCascade';
import { SopMarkdown } from './SopMarkdown';
import { type FinishAction, isLiveRun, useSopRun } from './useSopRun';

type Peeked = SopDocumentPayload | 'error';

/** Whether a peeked document renders as a live checklist (the page's rule). */
export function isChecklistPayload(doc: Peeked): boolean {
  return doc !== 'error' && doc.taskCount > 0 && !doc.sop.archived;
}

/**
 * The live checklist for one peeked document. Owns its own run controller —
 * the modal keys this by slug, so every document opened gets a fresh one. A
 * body for the same document as the page underneath (A → B → A) is
 * independent of the page's controller; taps in one show in the other on its
 * next mount or refetch.
 */
export function PeekChecklist({
  payload,
  linked,
  onProgress,
  onSopLink,
  onConfirmOpenChange,
}: {
  payload: SopDocumentPayload;
  /** Live progress of sub-checklists, as the parent knows it (overrides the payload's). */
  linked?: LinkedProgressMap;
  /** Reports this checklist's progress for the bar under the item that links here. */
  onProgress?: (progress: LinkedProgress) => void;
  onSopLink: (slug: string) => void;
  /** Whether the finish confirm dialog is open, so the modal's Escape defers to it. */
  onConfirmOpenChange?: (open: boolean) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { sop, taskCount } = payload;

  const latestProgress = useRef(onProgress);
  latestProgress.current = onProgress;

  const run = useSopRun({
    sop,
    taskCount,
    viewerEmail: payload.viewerEmail,
    initialRun: payload.run,
    loadedAt: payload.loadedAt,
    onError: setError,
    onNotice: setNotice,
  });

  // What the bar under the parent's item should say: the open run's count,
  // "completed" for a finished run still on screen, nothing once cleared.
  useEffect(() => {
    const state = run.runData;
    latestProgress.current?.({
      slug: sop.slug,
      sopId: sop.id,
      taskCount: state?.run.task_count ?? taskCount,
      checked: state?.checks.length ?? 0,
      status: !state ? 'none' : isLiveRun(state) ? 'in_progress' : 'completed',
    });
  }, [run.runData, sop.slug, sop.id, taskCount]);

  useEffect(() => {
    onConfirmOpenChange?.(run.confirmAction !== null);
    return () => onConfirmOpenChange?.(false);
  }, [run.confirmAction, onConfirmOpenChange]);

  const people = useMemo(
    () => ({ ...payload.people, ...run.people }),
    [payload.people, run.people]
  );
  const linkedHere = useMemo(() => ({ ...payload.linked, ...linked }), [payload.linked, linked]);

  // A tap here checks the box, and — for an item that links to another
  // checklist — every item of that one too.
  const onToggle = (items: CheckItems, checked: boolean) => {
    run.toggleCheck(items, checked);
    if (checked && onProgress) cascadeLinked(items, linkedHere, onProgress, setError);
  };

  return (
    <div className="space-y-4">
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
      <ChecklistView
        content={run.runData?.content ?? sop.content_md}
        run={run.runData?.run ?? null}
        checks={run.runData?.checks ?? []}
        people={people}
        linked={linkedHere}
        currentVersion={sop.current_version}
        busy={run.runBusy || run.pending > 0}
        headerOffset="none"
        onSopLink={onSopLink}
        onToggle={onToggle}
        onFinish={() => run.requestFinish('complete')}
        onDiscard={() => run.requestFinish('discard')}
        onStartAgain={run.startAgain}
      />
      {run.confirmAction && run.runData && (
        <ChecklistConfirmDialog
          action={run.confirmAction}
          runData={run.runData}
          busy={run.runBusy}
          onConfirm={() => void run.finishRun(run.confirmAction as FinishAction)}
          onCancel={run.cancelConfirm}
        />
      )}
    </div>
  );
}

export function SopPeekModal({
  slug,
  linked,
  since,
  onProgress,
  onClose,
}: {
  slug: string;
  /** Live sub-checklist progress from the parent, shared with every level of the stack. */
  linked?: LinkedProgressMap;
  /** When the parent's run started (ISO): a sub-checklist finished since then
   * opens showing its ticks. Applies to every level of the stack. */
  since?: string;
  onProgress?: (progress: LinkedProgress) => void;
  onClose: () => void;
}) {
  // Stack of slugs opened in this modal; the last entry is on screen.
  const [stack, setStack] = useState<string[]>([slug]);
  const [doc, setDoc] = useState<Peeked | null>(null);
  // Only documents that can't go stale are kept: prose pages and errors. A
  // checklist is refetched on every visit (Back included) so it shows the
  // shared run as it is now, not as it was before the taps made here.
  const cache = useRef(new Map<string, Peeked>());
  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // While the finish confirm dialog is up, Escape belongs to it.
  const confirmOpenRef = useRef(false);
  const titleId = useId();

  const current = stack[stack.length - 1];

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !confirmOpenRef.current) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const cached = cache.current.get(current);
    if (cached) {
      setDoc(cached);
      return;
    }
    setDoc(null);
    let cancelled = false;
    void (async () => {
      let entry: Peeked = 'error';
      try {
        const query = new URLSearchParams({ slug: current });
        if (since) query.set('since', since);
        const res = await fetch(`/api/admin/sops?${query}`);
        if (res.ok) entry = (await res.json()) as SopDocumentPayload;
      } catch {
        // Falls through as 'error'.
      }
      if (!isChecklistPayload(entry)) cache.current.set(current, entry);
      if (!cancelled) setDoc(entry);
    })();
    return () => {
      cancelled = true;
    };
  }, [current, since]);

  const navigate = (next: string[]) => {
    setStack(next);
    // A "new page" inside the same scroll container: start back at the top.
    bodyRef.current?.scrollTo({ top: 0 });
    closeRef.current?.focus();
  };

  const onConfirmOpenChange = useCallback((open: boolean) => {
    confirmOpenRef.current = open;
  }, []);

  const openLink = (next: string) => navigate([...stack, next]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-0 sm:items-center sm:p-4">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/70"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[85vh] w-full max-w-2xl flex-col whitespace-normal rounded-t-lg border border-white/15 bg-[var(--pyre-black)] shadow-xl sm:rounded-lg"
      >
        <div className="flex items-center gap-3 border-b border-white/10 p-4">
          {stack.length > 1 && (
            <button
              type="button"
              onClick={() => navigate(stack.slice(0, -1))}
              className="shrink-0 rounded border border-white/10 px-2 py-1.5 font-mono text-xs uppercase tracking-wide text-white/60 transition-colors hover:border-white/30 hover:text-white"
            >
              ← Back
            </button>
          )}
          <h2
            id={titleId}
            className="font-primary-semibold min-w-0 flex-1 truncate text-lg text-[var(--pyre-creme)]"
          >
            {doc && doc !== 'error' ? doc.sop.title : 'SOP'}
          </h2>
          <a
            href={`/admin/sops/${current}`}
            className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-white/50 underline hover:text-white"
          >
            Open full page
          </a>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="shrink-0 rounded border border-white/20 px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-white/60 transition-colors hover:border-white/40 hover:text-white"
          >
            Close
          </button>
        </div>
        <div ref={bodyRef} className="overflow-y-auto p-5">
          {doc === null ? (
            <p className="font-mono text-xs text-white/40">Loading…</p>
          ) : doc === 'error' ? (
            <p className="text-sm text-white/70">
              This SOP isn't available — it may have been removed, or it isn't shared with you.
            </p>
          ) : isChecklistPayload(doc) ? (
            <PeekChecklist
              key={current}
              payload={doc}
              linked={linked}
              onProgress={onProgress}
              onSopLink={openLink}
              onConfirmOpenChange={onConfirmOpenChange}
            />
          ) : (
            <SopMarkdown content={doc.sop.content_md} onSopLink={openLink} />
          )}
        </div>
      </div>
    </div>
  );
}

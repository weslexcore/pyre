// Peek modal for in-checklist SOP links: clicking "[Clear towel hampers]
// (/admin/sops/momence-dirty-towels)" mid-run opens the tutorial here instead
// of navigating away from a half-finished checklist. Links inside the modal to
// other library documents navigate within it (a simple stack with Back);
// "Open full page" is the escape hatch for long reads. Content comes from the
// same /api/admin/sops endpoint the document page uses, so access rules hold —
// a document the viewer may not read answers 404 and shows as unavailable.
// Modal mechanics follow the MeasurementInfo pattern (backdrop button, Escape,
// focus on Close, bottom sheet on mobile).
import { useEffect, useId, useRef, useState } from 'react';
import type { SopRow } from '@/lib/db';
import { SopMarkdown } from './SopMarkdown';

type Peeked = { title: string; content: string } | 'error';

export function SopPeekModal({ slug, onClose }: { slug: string; onClose: () => void }) {
  // Stack of slugs opened in this modal; the last entry is on screen.
  const [stack, setStack] = useState<string[]>([slug]);
  const [doc, setDoc] = useState<Peeked | null>(null);
  const cache = useRef(new Map<string, Peeked>());
  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const current = stack[stack.length - 1];

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
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
        const res = await fetch(`/api/admin/sops?slug=${encodeURIComponent(current)}`);
        if (res.ok) {
          const body = (await res.json()) as { sop: SopRow };
          entry = { title: body.sop.title, content: body.sop.content_md };
        }
      } catch {
        // Falls through as 'error'.
      }
      cache.current.set(current, entry);
      if (!cancelled) setDoc(entry);
    })();
    return () => {
      cancelled = true;
    };
  }, [current]);

  const navigate = (next: string[]) => {
    setStack(next);
    // A "new page" inside the same scroll container: start back at the top.
    bodyRef.current?.scrollTo({ top: 0 });
    closeRef.current?.focus();
  };

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
            {doc && doc !== 'error' ? doc.title : 'SOP'}
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
          ) : (
            <SopMarkdown content={doc.content} onSopLink={(next) => navigate([...stack, next])} />
          )}
        </div>
      </div>
    </div>
  );
}

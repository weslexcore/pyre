// The writing assistant panel in the SOP editor (POST /api/admin/sop-assist).
// Two actions over the editor's current, unsaved text: "Draft from notes"
// turns rough details into a formatted document, and "Review" reads the
// document for clarity and consistency with the library and proposes a
// revision. Either way the proposal shows as a diff against the editor's text
// with what the assistant found, the facts it needs confirmed, and any
// checklist items, required markers, or links it would lose. "Use this
// version" puts it in the editor; nothing is saved until Save.
//
// Rough notes typed on the library's create form arrive through
// sessionStorage (see assistNotesKey) and start a draft as soon as the new
// document's editor opens.

import { useEffect, useMemo, useRef, useState } from 'react';
import { buttonClass, inputClass } from '@/components/admin/ui';
import { readError } from '@/lib/client/api';
import type { AssistFinding, AssistMode, AssistProposal } from '@/lib/sops/assist';
import { assistStructureWarnings } from '@/lib/sops/assist-checks';
import { SopDiff } from './SopDiff';

/** Where the create form leaves its rough notes for the new document's editor. */
export function assistNotesKey(slug: string): string {
  return `sop-assist-notes:${slug}`;
}

/** Notes left by the create form, removed as they are read. Null when none (or no storage). */
function takeHandoffNotes(slug: string): string | null {
  try {
    const key = assistNotesKey(slug);
    const notes = window.sessionStorage.getItem(key);
    window.sessionStorage.removeItem(key);
    return notes?.trim() ? notes : null;
  } catch {
    return null;
  }
}

const SEVERITY_CLASS: Record<AssistFinding['severity'], string> = {
  high: 'border-[var(--pyre-red)]/50 text-[var(--pyre-red)]',
  medium: 'border-[var(--pyre-gold)]/50 text-[var(--pyre-gold)]',
  low: 'border-white/20 text-white/50',
};

const tabClass = (active: boolean) =>
  `${buttonClass} ${active ? 'border-white/40 text-white' : ''}`;

export function SopAssist({
  sopId,
  slug,
  title,
  content,
  disabled,
  autoReview,
  onApply,
}: {
  sopId: string;
  slug: string;
  /** The editor's current title and body; what the assistant works on. */
  title: string;
  content: string;
  disabled?: boolean;
  /** Start a review as soon as the panel opens (the document's "Review with AI" button). */
  autoReview?: boolean;
  onApply: (proposal: AssistProposal) => void;
}) {
  // A document that is only its stub heading has nothing to review yet, so
  // the panel opens on drafting.
  const isEmpty = content.replace(/^\s*#[^\n]*\n?/, '').trim() === '';
  const [tab, setTab] = useState<AssistMode>(isEmpty ? 'draft' : 'review');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<AssistMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The proposal, and the text it was made against (the diff's "before").
  const [result, setResult] = useState<{
    proposal: AssistProposal;
    before: string;
    beforeTitle: string;
  } | null>(null);

  const run = async (mode: AssistMode, withNotes = notes) => {
    setBusy(mode);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/admin/sop-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sopId, mode, title, content, notes: withNotes }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const { proposal } = (await res.json()) as { proposal: AssistProposal };
      setResult({ proposal, before: content, beforeTitle: title });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The assistant failed');
    } finally {
      setBusy(null);
    }
  };

  // Once per mount: the create form's notes, or the document's review button.
  const started = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only, against the text the editor opened with
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const handoff = takeHandoffNotes(slug);
    if (handoff) {
      setTab('draft');
      setNotes(handoff);
      void run('draft', handoff);
    } else if (autoReview && !isEmpty) {
      setTab('review');
      void run('review');
    }
  }, []);

  const warnings = useMemo(
    () => (result ? assistStructureWarnings(result.before, result.proposal.contentMd) : []),
    [result]
  );
  // The editor's text moved on since the proposal was made: accepting would
  // throw away whatever was typed meanwhile.
  const stale = result !== null && (result.before !== content || result.beforeTitle !== title);
  const unchanged =
    result !== null &&
    result.proposal.contentMd.trim() === result.before.trim() &&
    result.proposal.title === result.beforeTitle;

  return (
    <div className="space-y-3 rounded border border-white/10 bg-white/5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-2 font-mono text-xs uppercase tracking-wide text-white/40">
          Writing assistant
        </h2>
        <button type="button" className={tabClass(tab === 'draft')} onClick={() => setTab('draft')}>
          Draft from notes
        </button>
        <button
          type="button"
          className={tabClass(tab === 'review')}
          onClick={() => setTab('review')}
        >
          Review
        </button>
      </div>

      {tab === 'draft' ? (
        <div className="space-y-2">
          <textarea
            className={`${inputClass} min-h-32 w-full resize-y text-sm`}
            value={notes}
            disabled={disabled || busy !== null}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Rough details, in any order: the steps, what to watch for, who does it, when. Shorthand is fine."
            maxLength={20_000}
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={buttonClass}
              disabled={disabled || busy !== null || !notes.trim()}
              onClick={() => void run('draft')}
            >
              {busy === 'draft' ? 'Drafting…' : isEmpty ? 'Draft SOP' : 'Work into document'}
            </button>
            <span className="font-mono text-[10px] text-white/40">
              {isEmpty
                ? 'Writes the document in the library’s format. Missing facts are marked TBD, never guessed.'
                : 'Folds these notes into the text already in the editor.'}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={buttonClass}
            disabled={disabled || busy !== null || isEmpty}
            onClick={() => void run('review')}
          >
            {busy === 'review' ? 'Reviewing…' : 'Review this SOP'}
          </button>
          <span className="font-mono text-[10px] text-white/40">
            {isEmpty
              ? 'Nothing to review yet. Draft from notes first.'
              : 'Checks clarity, format, gaps, and consistency with the rest of the library, then proposes a revision.'}
          </span>
        </div>
      )}

      {busy && (
        <p className="font-mono text-xs text-white/40">
          This can take up to a minute for a long document.
        </p>
      )}
      {error && <p className="text-sm text-[var(--pyre-red)]">{error}</p>}

      {result && (
        <div className="space-y-3 border-t border-white/10 pt-3">
          {result.proposal.summary && (
            <p className="text-sm text-white/80">{result.proposal.summary}</p>
          )}

          {result.proposal.findings.length > 0 && (
            <ul className="space-y-2">
              {result.proposal.findings.map((finding, i) => (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: findings are a fixed list per proposal
                  key={i}
                  className="rounded border border-white/10 bg-black/20 px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${SEVERITY_CLASS[finding.severity]}`}
                    >
                      {finding.severity}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-wide text-white/40">
                      {finding.kind}
                    </span>
                  </div>
                  {finding.excerpt && (
                    <p className="mt-1 border-l-2 border-white/20 pl-2 text-xs text-white/50 italic">
                      {finding.excerpt}
                    </p>
                  )}
                  <p className="mt-1 text-white/80">{finding.issue}</p>
                  {finding.fix && <p className="mt-0.5 text-xs text-white/50">{finding.fix}</p>}
                </li>
              ))}
            </ul>
          )}

          {result.proposal.openQuestions.length > 0 && (
            <div className="rounded border border-[var(--pyre-gold)]/30 bg-[var(--pyre-gold)]/5 px-3 py-2">
              <p className="font-mono text-[10px] uppercase tracking-wide text-[var(--pyre-gold)]">
                To confirm before saving (marked TBD in the text)
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-white/80">
                {result.proposal.openQuestions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            </div>
          )}

          {warnings.length > 0 && (
            <ul className="space-y-1 rounded border border-white/10 bg-black/20 px-3 py-2 text-sm">
              {warnings.map((warning) => (
                // A changed item count is often the point (one step split in
                // two); a dropped required marker or link rarely is.
                <li
                  key={warning.kind}
                  className={
                    warning.kind === 'tasks' ? 'text-[var(--pyre-gold)]' : 'text-[var(--pyre-red)]'
                  }
                >
                  {warning.message}
                </li>
              ))}
            </ul>
          )}

          {unchanged ? (
            <p className="font-mono text-xs text-white/50">No changes proposed.</p>
          ) : (
            <>
              {result.proposal.title !== result.beforeTitle && (
                <p className="font-mono text-xs text-white/60">
                  Title: <span className="line-through opacity-60">{result.beforeTitle}</span>
                  {' → '}
                  <span className="text-[var(--pyre-sage)]">{result.proposal.title}</span>
                </p>
              )}
              <SopDiff
                before={result.before}
                after={result.proposal.contentMd}
                context={3}
                className="max-h-[32rem]"
              />
            </>
          )}

          {stale && (
            <p className="font-mono text-[10px] text-[var(--pyre-gold)]">
              The editor has changed since this was made. Using it replaces those edits.
            </p>
          )}
          <div className="flex gap-2">
            {!unchanged && (
              <button
                type="button"
                className={buttonClass}
                disabled={disabled}
                onClick={() => {
                  onApply(result.proposal);
                  setResult(null);
                }}
              >
                Use this version
              </button>
            )}
            <button type="button" className={buttonClass} onClick={() => setResult(null)}>
              {unchanged ? 'Close' : 'Discard'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

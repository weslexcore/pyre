// One agent suggestion, for an admin to decide. A pending one opens as an
// editor holding the agent's proposal (or the admin's saved edit of it):
// whatever is in the editor when they press Approve is what gets applied, so a
// small wording change never needs a second trip to the card or the SOP.
// Dismiss takes an optional reason, which the agent sees the next time it
// reads the same record. A decided one collapses to a line with a link to
// what it made.

import { useEffect, useMemo, useState } from 'react';
import type { PeopleNames } from '@/lib/sops/names';
import { personName } from '@/lib/sops/names';
import {
  currentPayload,
  describeSuggestion,
  KIND_LABELS,
  type PayloadByKind,
  parsePayload,
  type SuggestionKind,
  type SuggestionResultLink,
  type SuggestionView,
} from '@/lib/suggestions/types';
import { buttonClass, inputClass, primaryButtonClass } from '../ShiftNoteComposer';
import { CHIP_CLASS, SparkleIcon } from '../Signals';
import * as api from './client';
import { type EditorProps, SUGGESTION_EDITORS } from './editors';

const KIND_TONES: Record<SuggestionKind, string> = {
  'board_card.create':
    'border-[var(--pyre-gold)]/50 bg-[var(--pyre-gold)]/10 text-[var(--pyre-gold)]',
  'board_card.comment': 'border-white/20 bg-white/5 text-white/70',
  'sop.edit': 'border-[var(--pyre-creme)]/40 bg-[var(--pyre-creme)]/10 text-[var(--pyre-creme)]',
};

export function KindBadge({ kind }: { kind: SuggestionKind }) {
  return <span className={`${CHIP_CLASS} ${KIND_TONES[kind]}`}>{KIND_LABELS[kind]}</span>;
}

/** Renders the kind's editor with its payload type intact. */
function Editor<K extends SuggestionKind>({ kind, ...props }: { kind: K } & EditorProps<K>) {
  const Component = SUGGESTION_EDITORS[kind] as (p: EditorProps<K>) => React.JSX.Element;
  return <Component {...props} />;
}

function samePayload(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * A stored payload in the shape its editor holds, or null when it can't be
 * read as one. Parsed once, when the suggestion loads — never while the admin
 * types, since parsing trims text and would eat a space the moment it's typed.
 */
function editable(kind: SuggestionKind, raw: unknown): Record<string, unknown> | null {
  const parsed = parsePayload(kind, raw);
  return parsed.ok ? (parsed.value as unknown as Record<string, unknown>) : null;
}

export function SuggestionCard({
  suggestion,
  result,
  target,
  names,
  onChange,
  onDecided,
  collapsible = false,
}: {
  suggestion: SuggestionView;
  result?: SuggestionResultLink;
  target?: SuggestionResultLink;
  names: PeopleNames;
  /** A new version of this suggestion (saved, decided, or refreshed after a conflict). */
  onChange: (next: SuggestionView, result?: SuggestionResultLink) => void;
  /** It was approved or dismissed. */
  onDecided?: (next: SuggestionView) => void;
  /**
   * Start as a one-line summary that opens into the editor on a click (under
   * a shift note, where an open editor would crowd out the note itself).
   */
  collapsible?: boolean;
}) {
  const kind = suggestion.kind;
  const saved = currentPayload(suggestion);
  // The saved copy and the agent's original, in editor shape, to compare the
  // draft against (the draft itself is exactly what the admin typed).
  const baseline = useMemo(() => editable(kind, saved), [kind, saved]);
  const original = useMemo(() => editable(kind, suggestion.payload), [kind, suggestion.payload]);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(baseline);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [dismissNote, setDismissNote] = useState('');
  const [open, setOpen] = useState(!collapsible);

  // A saved edit or a rebase from elsewhere replaces the draft.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the saved copy's identity
  useEffect(() => {
    setDraft(editable(kind, currentPayload(suggestion)));
  }, [suggestion.edited_at, suggestion.id]);

  // Checked for the buttons and the error line only; the editor keeps the text as typed.
  const parsed = parsePayload(kind, draft);
  const dirty = !samePayload(draft, baseline);
  const editedFromOriginal = !samePayload(draft, original);
  const pending = suggestion.status === 'pending' || suggestion.status === 'applying';

  const run = async (action: () => Promise<api.Decided>, decides: boolean) => {
    setBusy(true);
    setError(null);
    setConflict(false);
    try {
      const { suggestion: next, result: made } = await action();
      const view = { ...next, sourceChanged: suggestion.sourceChanged };
      onChange(view, made);
      if (decides) onDecided?.(view);
    } catch (e) {
      if (e instanceof api.SuggestionError) {
        setError(e.message);
        setConflict(e.status === 409 && kind === 'sop.edit' && !!e.detail?.currentVersion);
        if (e.suggestion) onChange({ ...e.suggestion, sourceChanged: suggestion.sourceChanged });
      } else {
        setError(e instanceof Error ? e.message : 'Something went wrong');
      }
    } finally {
      setBusy(false);
    }
  };

  if (!pending) {
    const who = suggestion.decided_by ? personName(suggestion.decided_by, names) : null;
    return (
      <div className="flex flex-wrap items-center gap-2 px-1 py-1 font-mono text-[10px] text-white/40">
        <KindBadge kind={kind} />
        <span className="min-w-0 truncate text-white/60">
          {describeSuggestion(kind, suggestion.applied_payload ?? saved)}
        </span>
        {suggestion.status === 'approved' ? (
          <span>
            approved{who ? ` by ${who}` : ''}
            {result?.href && (
              <>
                {' → '}
                <a
                  href={result.href}
                  className="text-[var(--pyre-gold)] underline hover:text-white"
                >
                  {result.label}
                </a>
              </>
            )}
          </span>
        ) : (
          <span>
            {suggestion.status}
            {who ? ` by ${who}` : ''}
            {suggestion.decision_note ? `: “${suggestion.decision_note}”` : ''}
          </span>
        )}
      </div>
    );
  }

  // Folded: one line saying what it proposes; the editor mounts on opening,
  // and a draft typed before folding it again is kept.
  if (!open) {
    return (
      <button
        type="button"
        aria-expanded={false}
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded border border-[var(--pyre-gold)]/25 bg-black/20 px-3 py-2 text-left transition-colors hover:border-[var(--pyre-gold)]/50 hover:bg-black/30"
      >
        <SparkleIcon className="shrink-0 text-[var(--pyre-gold)]" />
        <KindBadge kind={kind} />
        <span className="min-w-0 flex-1 truncate text-xs text-white/80">
          {describeSuggestion(kind, draft ?? saved)}
        </span>
        {(dirty || suggestion.edited_by) && (
          <span className="hidden shrink-0 font-mono text-[10px] text-white/40 sm:inline">
            edited
          </span>
        )}
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-[var(--pyre-gold)]">
          Review
        </span>
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded border border-[var(--pyre-gold)]/25 bg-black/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <SparkleIcon className="text-[var(--pyre-gold)]" />
        <KindBadge kind={kind} />
        {suggestion.confidence !== null && (
          <span className="font-mono text-[10px] text-white/30">
            {Math.round(suggestion.confidence * 100)}% sure
          </span>
        )}
        {suggestion.edited_by && (
          <span className="font-mono text-[10px] text-white/40">
            edited by {personName(suggestion.edited_by, names)}
          </span>
        )}
        {suggestion.sourceChanged && (
          <span className="font-mono text-[10px] text-[var(--pyre-gold)]">
            note edited since this was suggested
          </span>
        )}
        {collapsible && (
          <button
            type="button"
            aria-expanded={true}
            className="ml-auto font-mono text-[10px] uppercase tracking-wide text-white/40 hover:text-white"
            onClick={() => setOpen(false)}
          >
            Hide
          </button>
        )}
      </div>
      {suggestion.rationale && (
        <p className="text-xs italic text-white/60">{suggestion.rationale}</p>
      )}

      {draft ? (
        <>
          <Editor
            kind={kind}
            value={draft as unknown as PayloadByKind[typeof kind]}
            onChange={(next) => setDraft(next as unknown as Record<string, unknown>)}
            target={target}
            disabled={busy}
            idPrefix={`suggestion-${suggestion.id}`}
          />
          {!parsed.ok && (
            <p className="font-mono text-[10px] text-[var(--pyre-red)]">{parsed.error}</p>
          )}
        </>
      ) : (
        <p className="font-mono text-[10px] text-[var(--pyre-red)]">
          This suggestion’s saved form can’t be read, so it can’t be edited here.
          {(() => {
            const check = parsePayload(kind, saved);
            return check.ok ? null : ` ${check.error}`;
          })()}
        </p>
      )}

      {(error || suggestion.error) && (
        <p className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-2 py-1.5 font-mono text-[10px] text-[var(--pyre-red)]">
          {error ?? suggestion.error}
          {conflict && (
            <button
              type="button"
              className="ml-2 underline hover:text-white"
              disabled={busy}
              onClick={() => void run(() => api.rebase(suggestion.id), false)}
            >
              Rebase onto the current version
            </button>
          )}
        </p>
      )}

      {dismissing ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={`${inputClass} min-w-48 flex-1`}
            placeholder="Why not? (optional — the agent reads this next time)"
            value={dismissNote}
            maxLength={1000}
            onChange={(e) => setDismissNote(e.target.value)}
          />
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() => void run(() => api.dismiss(suggestion.id, dismissNote.trim()), true)}
          >
            Dismiss
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() => setDismissing(false)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={primaryButtonClass}
            disabled={busy || !parsed.ok || suggestion.status === 'applying'}
            onClick={() => void run(() => api.approve(suggestion.id, draft), true)}
          >
            {editedFromOriginal ? 'Approve with edits' : 'Approve'}
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() => setDismissing(true)}
          >
            Dismiss
          </button>
          {dirty && parsed.ok && (
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => void run(() => api.saveEdit(suggestion.id, draft), false)}
            >
              Save for later
            </button>
          )}
          {editedFromOriginal && (
            <button
              type="button"
              className="font-mono text-[10px] uppercase tracking-wide text-white/40 underline hover:text-white"
              disabled={busy}
              onClick={() => setDraft(original)}
            >
              Reset to the AI’s version
            </button>
          )}
        </div>
      )}
    </div>
  );
}

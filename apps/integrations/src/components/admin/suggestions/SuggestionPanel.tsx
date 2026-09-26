// A record's agent suggestions, under the record itself (a shift note's
// card): where the agent's latest look stands, the pending suggestions as
// editors, and the decided ones folded into a line each with a link to what
// they made. Admins only; the page never renders it for anyone else.

import { useState } from 'react';
import type { PeopleNames } from '@/lib/sops/names';
import type { RunView, SuggestionResultLink, SuggestionView } from '@/lib/suggestions/types';
import { SparkleIcon } from '../Signals';
import { SuggestionCard } from './SuggestionCard';

function RunLine({ run, onRetry }: { run: RunView; onRetry: () => void }) {
  const text = 'font-mono text-[10px] text-white/40';
  switch (run.status) {
    case 'queued':
    case 'running':
      return (
        <p className={`${text} flex items-center gap-1.5`} aria-live="polite">
          <SparkleIcon className="animate-pulse text-[var(--pyre-gold)]" />
          Looking for follow-up work…
        </p>
      );
    case 'failed':
      return (
        <p className={text}>
          The agent couldn’t finish{run.error ? ` (${run.error})` : ''}.{' '}
          <button type="button" className="underline hover:text-white" onClick={onRetry}>
            Try again
          </button>
        </p>
      );
    case 'done':
      return run.count === 0 ? <p className={text}>The agent found nothing to file.</p> : null;
  }
}

export function SuggestionPanel({
  suggestions,
  run,
  results,
  targets,
  names,
  onRetry,
  onChange,
  onDecided,
}: {
  suggestions: SuggestionView[];
  run: RunView | undefined;
  results: Record<string, SuggestionResultLink>;
  targets: Record<string, SuggestionResultLink>;
  names: PeopleNames;
  onRetry: () => void;
  onChange: (next: SuggestionView, result?: SuggestionResultLink) => void;
  onDecided: (next: SuggestionView) => void;
}) {
  const [showDecided, setShowDecided] = useState(false);
  const pending = suggestions.filter((s) => s.status === 'pending' || s.status === 'applying');
  const decided = suggestions.filter((s) => s.status === 'approved' || s.status === 'dismissed');
  if (!run && suggestions.length === 0) return null;

  return (
    <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
      {run && <RunLine run={run} onRetry={onRetry} />}
      {pending.map((suggestion) => (
        <SuggestionCard
          key={suggestion.id}
          suggestion={suggestion}
          target={targets[suggestion.id]}
          names={names}
          onChange={onChange}
          onDecided={onDecided}
          collapsible
        />
      ))}
      {decided.length > 0 && (
        <div>
          <button
            type="button"
            className="font-mono text-[10px] uppercase tracking-wide text-white/40 hover:text-white"
            aria-expanded={showDecided}
            onClick={() => setShowDecided((on) => !on)}
          >
            {showDecided ? 'Hide' : 'Show'} {decided.length} decided suggestion
            {decided.length === 1 ? '' : 's'}
          </button>
          {showDecided &&
            decided.map((suggestion) => (
              <SuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                result={results[suggestion.id]}
                names={names}
                onChange={onChange}
              />
            ))}
        </div>
      )}
    </div>
  );
}

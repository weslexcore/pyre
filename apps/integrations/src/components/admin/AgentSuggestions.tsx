// The SOP, message and inventory suggestions Pyre Agent filed in one answer, drawn
// under it. They are the same suggestions the shift-note agent files: someone
// who decides suggestions (an admin, or the Suggestions page) gets the same
// card as under a shift note — the editor with the agent's change, Approve
// and Dismiss, with a batch of inventory changes as one table to approve
// together — and anyone else sees that it went to the admins and, later,
// what they decided.

import type { PeopleNames } from '@/lib/sops/names';
import { personName } from '@/lib/sops/names';
import {
  currentPayload,
  describeSuggestion,
  type SuggestionResultLink,
  type SuggestionView,
} from '@/lib/suggestions/types';
import { groupForReview } from './suggestions/grouping';
import { InventoryBatch } from './suggestions/InventoryBatch';
import { KindBadge, SuggestionCard } from './suggestions/SuggestionCard';

/** The conversation's suggestions as /api/admin/agent-actions returns them. */
export interface ConversationSuggestions {
  items: SuggestionView[];
  results: Record<string, SuggestionResultLink>;
  targets: Record<string, SuggestionResultLink>;
  people: PeopleNames;
  canDecide: boolean;
}

export const NO_SUGGESTIONS: ConversationSuggestions = {
  items: [],
  results: {},
  targets: {},
  people: {},
  canDecide: false,
};

interface Props {
  suggestions: SuggestionView[];
  context: ConversationSuggestions;
  onChange: (next: SuggestionView, result?: SuggestionResultLink) => void;
}

/** What someone who cannot decide it sees: where it stands, and what came of it. */
function WaitingCard({
  suggestion,
  result,
  names,
}: {
  suggestion: SuggestionView;
  result?: SuggestionResultLink;
  names: PeopleNames;
}) {
  const who = suggestion.decided_by ? personName(suggestion.decided_by, names) : null;
  const payload = suggestion.applied_payload ?? currentPayload(suggestion);
  return (
    <div className="rounded border border-white/10 bg-black/20 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <KindBadge kind={suggestion.kind} />
        <span className="min-w-0 flex-1 text-xs text-white/80">
          {describeSuggestion(suggestion.kind, payload)}
        </span>
      </div>
      {suggestion.rationale && (
        <p className="mt-1.5 text-xs italic text-white/50">{suggestion.rationale}</p>
      )}
      <p className="mt-1.5 font-mono text-[10px] text-white/50">
        {suggestion.status === 'approved' ? (
          <>
            Approved{who ? ` by ${who}` : ''}
            {result?.href && (
              <>
                {' — '}
                <a
                  href={result.href}
                  className="text-[var(--pyre-gold)] underline hover:text-white"
                >
                  {result.label}
                </a>
              </>
            )}
          </>
        ) : suggestion.status === 'dismissed' ? (
          <>
            Dismissed{who ? ` by ${who}` : ''}
            {suggestion.decision_note ? `: “${suggestion.decision_note}”` : ''}
          </>
        ) : (
          'Sent to the admins to review. Nothing changes until one of them approves it.'
        )}
      </p>
    </div>
  );
}

export function AgentSuggestions({ suggestions, context, onChange }: Props) {
  if (suggestions.length === 0) return null;
  const waiting = suggestions.filter((s) => s.status === 'pending' || s.status === 'applying');
  return (
    <section className="mt-3 space-y-2" aria-label="Suggestions">
      <h3 className="font-mono text-[10px] uppercase tracking-wide text-white/40">
        {context.canDecide
          ? waiting.length > 0
            ? `Suggested — review and approve (${waiting.length} waiting)`
            : 'Suggestions'
          : 'Suggested — sent to the admins for review'}
      </h3>
      {context.canDecide
        ? groupForReview(suggestions).map((entry) =>
            entry.type === 'inventory' ? (
              <InventoryBatch
                key={entry.key}
                suggestions={entry.suggestions}
                names={context.people}
                onChange={onChange}
              />
            ) : (
              <SuggestionCard
                key={entry.suggestion.id}
                suggestion={entry.suggestion}
                result={context.results[entry.suggestion.id]}
                target={context.targets[entry.suggestion.id]}
                names={context.people}
                onChange={onChange}
              />
            )
          )
        : suggestions.map((suggestion) => (
            <WaitingCard
              key={suggestion.id}
              suggestion={suggestion}
              result={context.results[suggestion.id]}
              names={context.people}
            />
          ))}
    </section>
  );
}

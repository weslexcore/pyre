// The board changes Pyre Agent proposed in one answer, drawn under it: what
// each would do, why, and Apply / Dismiss. Applying runs the change through
// the board's own API as the person (/api/admin/agent-actions), so a refused
// one comes back with the board's reason and stays here to try again.

import { ACTION_KIND_LABELS, type ActionView } from '@/lib/pyre-agent/types';

interface Props {
  actions: ActionView[];
  /** The action being applied or dismissed right now, if any. */
  workingId: string | null;
  onApply: (id: string) => void;
  onDismiss: (id: string) => void;
}

const buttonClass =
  'rounded border px-3 py-1 text-xs font-mono uppercase tracking-wide transition-colors disabled:opacity-40';

export function AgentActions({ actions, workingId, onApply, onDismiss }: Props) {
  if (actions.length === 0) return null;
  const pending = actions.filter((a) => a.status === 'pending').length;
  return (
    <section className="mt-3 space-y-2" aria-label="Proposed changes">
      <h3 className="font-mono text-[10px] uppercase tracking-wide text-white/40">
        {pending > 0
          ? `Proposed — nothing changes until you apply (${pending} waiting)`
          : 'Proposed changes'}
      </h3>
      <ul className="space-y-2">
        {actions.map((action) => {
          const working = workingId === action.id || action.status === 'applying';
          const decided = action.status === 'applied' || action.status === 'dismissed';
          return (
            <li
              key={action.id}
              className={`rounded-lg border px-3 py-2.5 ${
                action.status === 'applied'
                  ? 'border-emerald-400/30 bg-emerald-400/5'
                  : action.status === 'dismissed'
                    ? 'border-white/5 bg-white/[0.02] opacity-60'
                    : 'border-[var(--pyre-gold)]/30 bg-[var(--pyre-gold)]/5'
              }`}
            >
              <p className="font-mono text-[10px] uppercase tracking-wide text-[var(--pyre-gold)]">
                {ACTION_KIND_LABELS[action.kind]}
              </p>
              <p className="mt-0.5 text-sm text-[var(--pyre-creme)]">{action.summary}</p>
              {action.details.length > 0 && (
                <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-white/70">
                  {action.details.map((line) => (
                    <li key={line} className="whitespace-pre-wrap">
                      {line}
                    </li>
                  ))}
                </ul>
              )}
              {action.rationale && (
                <p className="mt-1.5 text-xs italic text-white/45">{action.rationale}</p>
              )}
              {action.error && (
                <p className="mt-1.5 text-xs text-[var(--pyre-red)]">{action.error}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {!decided && (
                  <>
                    <button
                      type="button"
                      className={`${buttonClass} border-[var(--pyre-gold)]/60 bg-[var(--pyre-gold)]/15 text-[var(--pyre-gold)] hover:border-[var(--pyre-gold)]`}
                      disabled={working || workingId !== null}
                      onClick={() => onApply(action.id)}
                    >
                      {working ? 'Applying…' : 'Apply'}
                    </button>
                    <button
                      type="button"
                      className={`${buttonClass} border-white/10 bg-white/5 text-white/60 hover:border-white/30 hover:text-white`}
                      disabled={working || workingId !== null}
                      onClick={() => onDismiss(action.id)}
                    >
                      Dismiss
                    </button>
                  </>
                )}
                {action.status === 'applied' && (
                  <span className="text-xs text-emerald-300/90">
                    Applied
                    {action.resultHref ? (
                      <>
                        {' — '}
                        <a className="underline hover:text-emerald-200" href={action.resultHref}>
                          {action.resultLabel ?? 'open it'}
                        </a>
                      </>
                    ) : null}
                  </span>
                )}
                {action.status === 'dismissed' && (
                  <span className="text-xs text-white/40">Dismissed</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

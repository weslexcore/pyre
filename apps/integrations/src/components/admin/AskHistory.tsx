// The conversation list beside the Ask chat: the staff member's own earlier
// conversations with the knowledge assistant (their rows in the audit log,
// via /api/admin/knowledge-history), newest activity first, with a way to
// start a new one. Rendered twice by SopAsk — as the desktop sidebar and
// inside the mobile drawer — so it carries no layout of its own.

import { timeAgo } from '@/lib/client/relativeTime';
import type { ConversationSummary } from '@/lib/knowledge/history';

interface Props {
  conversations: ConversationSummary[];
  /** The conversation on screen, if it is one of the listed ones. */
  activeSessionId: string | null;
  /** The conversation being fetched after a click, for the row's pending look. */
  openingSessionId: string | null;
  loading: boolean;
  error: string | null;
  /** True while a question is in flight — switching mid-answer is disabled. */
  busy: boolean;
  onSelect: (sessionId: string) => void;
  onNew: () => void;
  /** Admins get the link to the review log of everyone's questions. */
  isAdmin: boolean;
}

const newChatClass =
  'w-full rounded border border-[var(--pyre-gold)]/50 bg-[var(--pyre-gold)]/10 px-3 py-2 text-xs font-mono uppercase tracking-wide text-[var(--pyre-gold)] hover:border-[var(--pyre-gold)] transition-colors disabled:opacity-40';

/** Today / Yesterday / Earlier buckets keep a long list scannable. */
function bucket(iso: string, now = new Date()): 'Today' | 'Yesterday' | 'Earlier' {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((day(now) - day(new Date(iso))) / 86_400_000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return 'Earlier';
}

export function AskHistory({
  conversations,
  activeSessionId,
  openingSessionId,
  loading,
  error,
  busy,
  onSelect,
  onNew,
  isAdmin,
}: Props) {
  const groups: { label: string; items: ConversationSummary[] }[] = [];
  for (const conversation of conversations) {
    const label = bucket(conversation.lastAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(conversation);
    else groups.push({ label, items: [conversation] });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 p-3">
        <button
          type="button"
          className={newChatClass}
          disabled={busy || activeSessionId === null}
          onClick={onNew}
        >
          + New chat
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="Previous conversations">
        {error && (
          <p className="px-2 py-1 text-xs text-[var(--pyre-red)]">
            Could not load history: {error}
          </p>
        )}
        {loading && conversations.length === 0 && !error && (
          <p className="px-2 py-1 font-mono text-[11px] uppercase tracking-wide text-white/40">
            Loading…
          </p>
        )}
        {!loading && conversations.length === 0 && !error && (
          <p className="px-2 py-1 text-xs text-white/40">
            Your conversations will show up here once you ask something.
          </p>
        )}
        {groups.map((group) => (
          <section key={group.label} className="mb-3">
            <h2 className="px-2 pb-1 pt-2 font-mono text-[10px] uppercase tracking-wide text-white/40">
              {group.label}
            </h2>
            <ul className="space-y-0.5">
              {group.items.map((conversation) => {
                const active = conversation.sessionId === activeSessionId;
                const opening = conversation.sessionId === openingSessionId;
                return (
                  <li key={conversation.sessionId}>
                    <button
                      type="button"
                      className={`flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left transition-colors disabled:cursor-default ${
                        active
                          ? 'bg-white/10 text-[var(--pyre-creme)]'
                          : 'text-white/70 hover:bg-white/5 hover:text-[var(--pyre-creme)] disabled:hover:bg-transparent'
                      } ${opening ? 'animate-pulse' : ''}`}
                      aria-current={active ? 'true' : undefined}
                      disabled={busy || openingSessionId !== null}
                      onClick={() => onSelect(conversation.sessionId)}
                      title={conversation.title}
                    >
                      <span className="line-clamp-2 text-sm leading-snug">
                        {conversation.title}
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-wide text-white/35">
                        {timeAgo(conversation.lastAt)} ·{' '}
                        {conversation.turnCount === 1
                          ? '1 question'
                          : `${conversation.turnCount} questions`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </nav>

      {isAdmin && (
        <div className="shrink-0 border-t border-white/10 p-3">
          <a
            href="/admin/ask/log"
            className="font-mono text-[11px] uppercase tracking-wide text-[var(--pyre-gold)] hover:underline"
          >
            Review everyone's questions →
          </a>
        </div>
      )}
    </div>
  );
}

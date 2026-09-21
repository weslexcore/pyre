// /admin/messages: the messages the admins have written that this person
// may read, pinned first, each linking to its thread. Admins also get the
// composer for a new message and can peek at the archive.
import { useState } from 'react';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import type { AdminMessageRow } from '@/lib/db';
import type { MessageSummary } from '@/lib/messages/store';
import { excerpt } from '@/lib/notifications/types';
import { describeGrants, type SopViewer } from '@/lib/sops/levels';
import { type PeopleNames, personName } from '@/lib/sops/names';
import { emptyDraft, MessageComposer, type MessageDraft } from './MessageComposer';
import { buttonClass, chipClass, formatStamp, primaryButtonClass, readError } from './messagesUi';
import type { GrantablePerson } from './SopAccessPicker';

interface ListResponse {
  messages: MessageSummary[];
  people: PeopleNames;
  viewer: SopViewer;
  staff?: GrantablePerson[];
}

export function MessagesIndex() {
  const [showArchived, setShowArchived] = useState(false);
  const url = `/api/admin/messages${showArchived ? '?archived=1' : ''}`;
  const feed = useCachedJson<ListResponse>(url);
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = feed.data?.viewer.role === 'admin';
  const people = feed.data?.people ?? {};

  const create = async (draft: MessageDraft) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draft.title,
          bodyMd: draft.bodyMd,
          audienceRoles: draft.audience.roles,
          audienceEmails: draft.audience.emails,
          pinned: draft.pinned,
        }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const { message } = (await res.json()) as { message: AdminMessageRow };
      invalidateJson('/api/admin/messages');
      window.location.assign(`/admin/messages/${message.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send');
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2">
          {!composing && (
            <button type="button" className={primaryButtonClass} onClick={() => setComposing(true)}>
              New message
            </button>
          )}
          <button
            type="button"
            className={`${buttonClass} ml-auto ${showArchived ? 'border-white/40 text-white' : ''}`}
            aria-pressed={showArchived}
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? 'Hide archived' : 'Show archived'}
          </button>
        </div>
      )}

      {composing && isAdmin && (
        <section className="rounded border border-white/10 bg-white/5 p-4">
          <h2 className="mb-3 font-mono text-[10px] font-bold uppercase tracking-wide text-white/40">
            New message
          </h2>
          <MessageComposer
            initial={emptyDraft()}
            staff={feed.data?.staff ?? []}
            busy={busy}
            submitLabel="Send"
            onSubmit={(draft) => void create(draft)}
            onCancel={() => setComposing(false)}
          />
        </section>
      )}

      {error && (
        <p
          role="alert"
          className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-2 text-sm text-[var(--pyre-red)]"
        >
          {error}
        </p>
      )}
      {feed.error && !feed.data && (
        <p role="alert" className="text-sm text-[var(--pyre-red)]">
          Couldn't load messages: {feed.error}
        </p>
      )}

      {feed.loading ? (
        <p className="py-8 text-center text-sm text-white/40">Loading…</p>
      ) : (feed.data?.messages.length ?? 0) === 0 ? (
        <p className="py-8 text-center text-sm text-white/40">
          {isAdmin ? 'No messages yet. Write the first one.' : 'No messages for you yet.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {feed.data?.messages.map((m) => (
            <li key={m.id}>
              <a
                href={`/admin/messages/${m.id}`}
                data-astro-prefetch
                className={`block rounded border px-4 py-3 transition-colors hover:border-white/30 hover:bg-white/5 ${
                  m.pinned ? 'border-[var(--pyre-gold)]/40' : 'border-white/10'
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  {m.pinned && (
                    <span
                      className={`${chipClass} border-[var(--pyre-gold)]/50 text-[var(--pyre-gold)]`}
                    >
                      Pinned
                    </span>
                  )}
                  {m.archived_at && (
                    <span className={`${chipClass} border-white/15 text-white/40`}>Archived</span>
                  )}
                  <span className="text-base font-semibold text-[var(--pyre-creme)]">
                    {m.title}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-white/60">{excerpt(m.body_md, 220)}</p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-white/40">
                  <span>{personName(m.author_email, people)}</span>
                  <span title={formatStamp(m.created_at)}>{formatStamp(m.created_at)}</span>
                  <span>
                    {m.reply_count === 0
                      ? 'no replies'
                      : `${m.reply_count} ${m.reply_count === 1 ? 'reply' : 'replies'} · last ${formatStamp(m.last_activity_at)}`}
                  </span>
                  {isAdmin && (
                    <span className="ml-auto">
                      to {describeGrants(m.audience_roles, m.audience_emails)}
                    </span>
                  )}
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

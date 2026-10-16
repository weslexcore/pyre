// /admin/messages: the messages the admins have written that this person
// may read, pinned first, each linking to its thread. Admins also get the
// composer for a new message (send it, or save it as a draft) and can peek
// at the archive; the drafts they can work on sit above the sent list. The
// composer offers the message templates (/admin/messages/templates).
import { useEffect, useRef, useState } from 'react';
import { goldButtonClass } from '@/components/admin/ui';
import { type Backup, readBackup } from '@/lib/client/autosave';
import { useCachedJson } from '@/lib/client/cachedJson';
import { etStamp } from '@/lib/client/format';
import type { AdminMessageTemplateRow } from '@/lib/db';
import type { MessageSummary } from '@/lib/messages/store';
import { displayTitle } from '@/lib/messages/validate';
import { excerpt } from '@/lib/notifications/types';
import { describeGrants, type SopViewer } from '@/lib/sops/levels';
import { type PeopleNames, personName } from '@/lib/sops/names';
import { emptyDraft, hasContent, type MessageDraft } from './MessageComposer';
import { buttonClass, chipClass, draftSharing } from './messagesUi';
import { NewMessageComposer, type NewMessageMeta, newMessageBackupKey } from './NewMessageComposer';
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

  const isAdmin = feed.data?.viewer.role === 'admin';
  const templates = useCachedJson<{ templates: AdminMessageTemplateRow[] }>(
    composing && isAdmin ? '/api/admin/message-templates' : null
  );
  const people = feed.data?.people ?? {};
  const all = feed.data?.messages ?? [];
  const drafts = all.filter((m) => m.sent_at === null);
  const sent = all.filter((m) => m.sent_at !== null);

  // A new message that was being written when this admin last left reopens
  // here with what they'd typed (NewMessageComposer keeps it on the device
  // until the server has it). Checked once the list says who's looking.
  const [restored, setRestored] = useState<Backup<MessageDraft> | null>(null);
  const backupChecked = useRef(false);
  const viewerEmail = feed.data?.viewer.email ?? '';
  useEffect(() => {
    if (backupChecked.current || !isAdmin || !viewerEmail || !feed.data) return;
    backupChecked.current = true;
    const backup = readBackup<MessageDraft>(newMessageBackupKey(viewerEmail));
    if (!backup || !hasContent({ ...emptyDraft(), ...backup.value })) return;
    // A draft that has since been sent or deleted can't take the save; the
    // typing starts a new draft instead.
    const meta = backup.meta as NewMessageMeta | null;
    const stillDraft = !!meta?.id && feed.data.messages.some((m) => m.id === meta.id && !m.sent_at);
    setRestored(stillDraft ? backup : { ...backup, meta: { id: null, updatedAt: null } });
    setComposing(true);
  }, [isAdmin, viewerEmail, feed.data]);

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2">
          {!composing && (
            <button type="button" className={goldButtonClass} onClick={() => setComposing(true)}>
              New message
            </button>
          )}
          <a href="/admin/messages/templates" className={`${buttonClass} ml-auto`}>
            Templates
          </a>
          <button
            type="button"
            className={`${buttonClass} ${showArchived ? 'border-white/40 text-white' : ''}`}
            aria-pressed={showArchived}
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? 'Hide archived' : 'Show archived'}
          </button>
        </div>
      )}

      {composing && isAdmin && viewerEmail && (
        <NewMessageComposer
          staff={feed.data?.staff ?? []}
          templates={templates.data?.templates}
          viewerEmail={viewerEmail}
          restored={restored}
          onClose={() => {
            setComposing(false);
            setRestored(null);
            // The autosaved draft now belongs under Drafts.
            void feed.reload();
          }}
        />
      )}

      {feed.error && !feed.data && (
        <p role="alert" className="text-sm text-[var(--pyre-red)]">
          Couldn't load messages: {feed.error}
        </p>
      )}

      {drafts.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-mono text-[10px] font-bold uppercase tracking-wide text-white/40">
            Drafts
          </h2>
          <ul className="space-y-2">
            {drafts.map((m) => (
              <li key={m.id}>
                <a
                  href={`/admin/messages/${m.id}`}
                  data-astro-prefetch
                  className="block rounded border border-dashed border-white/20 px-4 py-3 transition-colors hover:border-white/40 hover:bg-white/5"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className={`${chipClass} border-white/30 text-white/60`}>Draft</span>
                    <span className="text-base font-semibold text-[var(--pyre-creme)]">
                      {displayTitle(m)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-white/60">
                    {excerpt(m.body_md, 220)}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-white/40">
                    <span>{personName(m.author_email, people)}</span>
                    <span>
                      saved {etStamp(m.updated_at)}
                      {m.updated_by && ` by ${personName(m.updated_by, people)}`}
                    </span>
                    <span className="ml-auto">{draftSharing(m, people)}</span>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {feed.loading ? (
        <p className="py-8 text-center text-sm text-white/40">Loading…</p>
      ) : sent.length === 0 ? (
        <p className="py-8 text-center text-sm text-white/40">
          {isAdmin ? 'No messages yet. Write the first one.' : 'No messages for you yet.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {sent.map((m) => (
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
                  <span>{etStamp(m.sent_at ?? m.created_at)}</span>
                  <span>
                    {m.reply_count === 0
                      ? 'no replies'
                      : `${m.reply_count} ${m.reply_count === 1 ? 'reply' : 'replies'} · last ${etStamp(m.last_activity_at)}`}
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

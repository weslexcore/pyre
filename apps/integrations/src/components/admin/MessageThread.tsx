// One admin message and its thread. The page loads the thread in its
// frontmatter and hands it over as `initial`, so this island paints at
// once; it then owns the conversation: replies (markdown, like the message),
// editing and deleting your own, and for admins the message itself — edit,
// pin, archive, delete. A draft shows no thread: its author and the admins
// it's shared with edit it, send it, or delete it. Editing is MessageEditor,
// which autosaves; edits someone left unsaved reopen when they come back.
// Every change shows the moment it is made — a reply joins the thread
// under a temporary id the server's row replaces, a pin or an archive flips
// at once — and is put back if the server refuses. Every mutation goes
// through the two API routes, which re-check access; the predicates in
// lib/messages/access decide which controls to draw.
import { useEffect, useState } from 'react';
import { confirmAction } from '@/components/admin/ConfirmDialog';
import { ErrorBanner } from '@/components/admin/ErrorBanner';
import { goldButtonClass } from '@/components/admin/ui';
import { readError } from '@/lib/client/api';
import { type Backup, clearBackup, readBackup } from '@/lib/client/autosave';
import { invalidateJson } from '@/lib/client/cachedJson';
import { etStamp } from '@/lib/client/format';
import { optimistic, tempId } from '@/lib/client/optimistic';
import type { AdminMessageReplyRow, AdminMessageRow } from '@/lib/db';
import {
  canChangeMessage,
  canReplyToMessage,
  canTouchReply,
  isDraft,
  roleIsNotified,
} from '@/lib/messages/access';
import type { MessageThreadPayload } from '@/lib/messages/store';
import { REPLY_MAX, sendProblem } from '@/lib/messages/validate';
import { describeGrants, type SopViewer } from '@/lib/sops/levels';
import { type PeopleNames, personName } from '@/lib/sops/names';
import { BackLink } from './BackLink';
import { ConfirmDialog } from './ConfirmDialog';
import { LinkTextarea } from './LinkTextarea';
import type { MessageDraft } from './MessageComposer';
import { draftOfMessage, MessageEditor, messageEditBackupKey } from './MessageEditor';
import {
  buttonClass,
  chipClass,
  dangerButtonClass,
  draftSharing,
  replyTextareaClass,
} from './messagesUi';
import type { GrantablePerson } from './SopAccessPicker';
import { SopMarkdown } from './SopMarkdown';

interface ThreadResponse extends MessageThreadPayload {
  viewer: SopViewer;
  staff?: GrantablePerson[];
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

export function MessageThread({
  initial,
  initialError,
  viewer,
}: {
  initial: MessageThreadPayload | null;
  initialError: string | null;
  viewer: SopViewer;
}) {
  const [message, setMessage] = useState<AdminMessageRow | null>(initial?.message ?? null);
  const [replies, setReplies] = useState<AdminMessageReplyRow[]>(initial?.replies ?? []);
  const [people, setPeople] = useState<PeopleNames>(initial?.people ?? {});
  const emailedTo = initial?.emailedTo ?? [];
  const [staff, setStaff] = useState<GrantablePerson[]>([]);
  const [error, setError] = useState<string | null>(initialError);
  // Only the two confirmations wait on the server: sending reloads the
  // page, deleting leaves it. Everything else shows at once.
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [editingReply, setEditingReply] = useState<{ id: string; body: string } | null>(null);
  const [editingMessage, setEditingMessage] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [restoredEdit, setRestoredEdit] = useState<Backup<MessageDraft> | null>(null);

  const isAdmin = message ? canChangeMessage(viewer, message) : false;
  const unsent = message ? isDraft(message) : false;

  // Admins editing need the roster for the audience picker, and a draft's
  // send confirmation names who it reaches; fetch it lazily.
  useEffect(() => {
    if (!(editingMessage || (unsent && isAdmin)) || staff.length > 0) return;
    void fetch('/api/admin/messages')
      .then((res) => (res.ok ? (res.json() as Promise<ThreadResponse>) : null))
      .then((data) => {
        if (data?.staff) setStaff(data.staff);
      })
      .catch(() => undefined);
  }, [editingMessage, unsent, isAdmin, staff.length]);

  /** The thread with `reply` in place of the row it replaces (or added), in writing order. */
  const withReply = (
    prev: AdminMessageReplyRow[],
    reply: AdminMessageReplyRow,
    replacing: string = reply.id
  ) =>
    [...prev.filter((r) => r.id !== replacing && r.id !== reply.id), reply].sort((a, b) =>
      a.created_at.localeCompare(b.created_at)
    );

  /** A reply's route call: the row and the names it introduces, folded in as it lands. */
  const sendReply = async (init: RequestInit) => {
    const data = await requestJson<{ reply: AdminMessageReplyRow; people: PeopleNames }>(
      '/api/admin/message-replies',
      init
    );
    setPeople((prev) => ({ ...prev, ...data.people }));
    invalidateJson('/api/admin/messages');
    return data;
  };

  const postReply = async () => {
    const bodyMd = draft.trim();
    if (!bodyMd || !message) return;
    setError(null);
    setDraft('');
    const now = new Date().toISOString();
    const pending: AdminMessageReplyRow = {
      id: tempId(),
      message_id: message.id,
      author_email: viewer.email ?? '',
      body_md: bodyMd,
      updated_by: null,
      created_at: now,
      updated_at: now,
    };
    await optimistic(
      setReplies,
      (prev) => withReply(prev, pending),
      () => sendReply({ method: 'POST', body: JSON.stringify({ messageId: message.id, bodyMd }) }),
      {
        reconcile: (prev, data) => withReply(prev, data.reply, pending.id),
        onError: (message) => {
          setError(message || 'Failed to post the reply');
          // Hand the words back so they are not lost.
          setDraft((current) => current || bodyMd);
        },
      }
    );
  };

  const saveReplyEdit = async () => {
    if (!editingReply) return;
    const { id, body } = editingReply;
    setError(null);
    setEditingReply(null);
    await optimistic(
      setReplies,
      (prev) => prev.map((r) => (r.id === id ? { ...r, body_md: body } : r)),
      () => sendReply({ method: 'PATCH', body: JSON.stringify({ id, bodyMd: body }) }),
      {
        reconcile: (prev, data) => withReply(prev, data.reply),
        onError: (message) => setError(message || 'Failed to save the reply'),
      }
    );
  };

  const deleteReply = async (reply: AdminMessageReplyRow) => {
    if (
      !(await confirmAction({ title: 'Delete this reply?', confirmLabel: 'Delete', danger: true }))
    )
      return;
    setError(null);
    await optimistic(
      setReplies,
      (prev) => prev.filter((r) => r.id !== reply.id),
      async () => {
        const res = await fetch(`/api/admin/message-replies?id=${encodeURIComponent(reply.id)}`, {
          method: 'DELETE',
        });
        if (!res.ok) throw new Error(await readError(res));
        invalidateJson('/api/admin/messages');
      },
      { onError: (message) => setError(message || 'Failed to delete the reply') }
    );
  };

  // An edit left unsaved last time (on this device) reopens the editor with
  // it. Read after hydration — the server render has no localStorage.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on load
  useEffect(() => {
    if (!message || !isAdmin) return;
    const backup = readBackup<MessageDraft>(messageEditBackupKey(message.id));
    if (!backup) return;
    const current = draftOfMessage(message);
    if (JSON.stringify({ ...current, ...backup.value }) === JSON.stringify(current)) {
      clearBackup(messageEditBackupKey(message.id));
      return;
    }
    setRestoredEdit(backup);
    setEditingMessage(true);
  }, []);

  const patchMessage = async (patch: Record<string, unknown>) => {
    if (!message) return;
    setError(null);
    const request = () =>
      requestJson<{ message: AdminMessageRow; people: PeopleNames }>('/api/admin/messages', {
        method: 'PATCH',
        body: JSON.stringify({ id: message.id, ...patch }),
      });
    if (patch.send === true) {
      // Sending waits: the page reloads to pick up who it was emailed to and
      // open the thread, and that has to be the sent message.
      setBusy(true);
      try {
        await request();
        invalidateJson('/api/admin/messages');
        window.location.reload();
        return;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to update the message');
        setBusy(false);
      } finally {
        setConfirmSend(false);
      }
      return;
    }
    // Pin and archive flip at once; the server's row replaces the guess.
    const guess: Partial<AdminMessageRow> = {};
    if (typeof patch.pinned === 'boolean') guess.pinned = patch.pinned;
    if (typeof patch.archived === 'boolean') {
      guess.archived_at = patch.archived ? new Date().toISOString() : null;
    }
    setEditingMessage(false);
    await optimistic(
      setMessage,
      (prev) => (prev ? { ...prev, ...guess } : prev),
      async () => {
        const data = await request();
        setPeople((prev) => ({ ...prev, ...data.people }));
        invalidateJson('/api/admin/messages');
        return data;
      },
      {
        reconcile: (_prev, data) => data.message,
        onError: (message) => setError(message || 'Failed to update the message'),
      }
    );
  };

  const deleteMessage = async () => {
    if (!message) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/messages?id=${encodeURIComponent(message.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(await readError(res));
      invalidateJson('/api/admin/messages');
      invalidateJson('/api/admin/notifications');
      window.location.assign('/admin/messages');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete the message');
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  if (!message) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-[var(--pyre-red)]">
          {error ?? 'Message not found'}
        </p>
        <BackLink href="/admin/messages">All messages</BackLink>
      </div>
    );
  }

  const notReady = unsent ? sendProblem(message) : null;
  const reached = staff.filter(
    (person) =>
      roleIsNotified(message, person.role) || message.audience_emails.includes(person.email)
  );

  return (
    <div className="space-y-6">
      <BackLink href="/admin/messages">All messages</BackLink>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <article className="rounded border border-white/10 bg-white/5 px-4 py-4">
        {editingMessage ? (
          <MessageEditor
            message={message}
            staff={staff}
            restored={restoredEdit}
            onDone={(latest, names) => {
              setMessage(latest);
              setPeople((prev) => ({ ...prev, ...names }));
              setRestoredEdit(null);
              setEditingMessage(false);
            }}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              {unsent && (
                <span className={`${chipClass} border-white/30 text-white/60`}>Draft</span>
              )}
              {message.pinned && (
                <span
                  className={`${chipClass} border-[var(--pyre-gold)]/50 text-[var(--pyre-gold)]`}
                >
                  Pinned
                </span>
              )}
              {message.archived_at && (
                <span className={`${chipClass} border-white/15 text-white/40`}>Archived</span>
              )}
              <span className="font-mono text-[10px] text-white/40">
                {personName(message.author_email, people)} ·{' '}
                {unsent
                  ? `saved ${etStamp(message.updated_at)}`
                  : etStamp(message.sent_at ?? message.created_at)}
                {message.updated_by && ` · edited by ${personName(message.updated_by, people)}`}
                {unsent && ` · ${draftSharing(message, people)}`}
              </span>
              {isAdmin && (
                <span className="font-mono text-[10px] text-white/30">
                  to {describeGrants(message.audience_roles, message.audience_emails)}
                </span>
              )}
            </div>
            <div className="mt-3">
              <SopMarkdown content={message.body_md} />
            </div>
            {emailedTo.length > 0 && (
              <p className="mt-3 font-mono text-[10px] text-white/40">
                Emailed to {emailedTo.map((email) => personName(email, people)).join(', ')}
              </p>
            )}
            {isAdmin && unsent && (
              <div className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-3">
                <button
                  type="button"
                  className={goldButtonClass}
                  disabled={busy || notReady !== null}
                  title={notReady ?? undefined}
                  onClick={() => setConfirmSend(true)}
                >
                  Send
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => setEditingMessage(true)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className={`${dangerButtonClass} ml-auto`}
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete
                </button>
              </div>
            )}
            {isAdmin && !unsent && (
              <div className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-3">
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => setEditingMessage(true)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => void patchMessage({ pinned: !message.pinned })}
                >
                  {message.pinned ? 'Unpin' : 'Pin'}
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => void patchMessage({ archived: !message.archived_at })}
                >
                  {message.archived_at ? 'Restore' : 'Archive'}
                </button>
                <button
                  type="button"
                  className={`${dangerButtonClass} ml-auto`}
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete
                </button>
              </div>
            )}
          </>
        )}
      </article>

      {unsent ? (
        <p className="text-xs text-white/40">
          Replies open once the message is sent. Until then nobody in its audience can see it.
        </p>
      ) : (
        <section className="space-y-3">
          <h2 className="font-mono text-[10px] font-bold uppercase tracking-wide text-white/40">
            {replies.length === 0
              ? 'No replies yet'
              : `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
          </h2>
          {replies.map((reply) => (
            <div key={reply.id} className="rounded border border-white/10 bg-white/5 px-3 py-2">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-xs font-semibold">
                  {personName(reply.author_email, people)}
                </span>
                <span className="font-mono text-[10px] text-white/40">
                  {etStamp(reply.created_at)}
                  {reply.updated_by && ` · edited by ${personName(reply.updated_by, people)}`}
                </span>
                {canTouchReply(reply, viewer) && editingReply?.id !== reply.id && (
                  <span className="ml-auto flex gap-2 font-mono text-[10px] uppercase tracking-wide text-white/40">
                    <button
                      type="button"
                      className="hover:text-white"
                      onClick={() => setEditingReply({ id: reply.id, body: reply.body_md })}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="hover:text-[var(--pyre-red)]"
                      onClick={() => void deleteReply(reply)}
                    >
                      Delete
                    </button>
                  </span>
                )}
              </div>
              {editingReply?.id === reply.id ? (
                <div className="mt-2 space-y-2">
                  <LinkTextarea
                    className={replyTextareaClass}
                    maxLength={REPLY_MAX}
                    value={editingReply.body}
                    onChange={(body) => setEditingReply({ id: reply.id, body })}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={goldButtonClass}
                      disabled={!editingReply.body.trim()}
                      onClick={() => void saveReplyEdit()}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className={buttonClass}
                      onClick={() => setEditingReply(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-1">
                  <SopMarkdown content={reply.body_md} />
                </div>
              )}
            </div>
          ))}

          {canReplyToMessage(viewer, message) ? (
            <div className="space-y-2">
              <LinkTextarea
                className={replyTextareaClass}
                placeholder="Reply… (markdown works)"
                maxLength={REPLY_MAX}
                value={draft}
                onChange={setDraft}
                aria-label={`Reply to ${message.title}`}
              />
              <button
                type="button"
                className={goldButtonClass}
                disabled={!draft.trim()}
                onClick={() => void postReply()}
              >
                Reply
              </button>
            </div>
          ) : (
            <p className="text-xs text-white/40">This message is archived; replies are closed.</p>
          )}
        </section>
      )}

      {confirmSend && (
        <ConfirmDialog
          title="Send this message?"
          body={
            reached.length === 0
              ? 'Nobody will be notified: no one on the roster is in its audience.'
              : `Notifies and emails ${reached.length}: ${reached.map((p) => p.name).join(', ')}. To send without email, edit it and untick "also email".`
          }
          confirmLabel="Send"
          busy={busy}
          onConfirm={() =>
            void patchMessage({ send: true, email: true, expectedUpdatedAt: message.updated_at })
          }
          onCancel={() => setConfirmSend(false)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={unsent ? 'Delete this draft?' : 'Delete this message?'}
          body={
            unsent
              ? 'The draft will be removed for everyone it is shared with.'
              : "The message, its replies, and everyone's notifications about it will be removed."
          }
          confirmLabel="Delete"
          danger
          busy={busy}
          onConfirm={() => void deleteMessage()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

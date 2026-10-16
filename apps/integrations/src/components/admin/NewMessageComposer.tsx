// Writing a new admin message on /admin/messages. It autosaves: as soon as
// there's anything in it, it becomes a private draft (POST draft: true), and
// every pause in typing after that saves the draft (PATCH, carrying the
// version it started from). Someone who leaves the page finds it under
// Drafts; on this device, it reopens right here with what they were typing
// (the local backup — lib/client/autosave). Send turns the draft into a sent
// message; Save draft opens the draft's own page; Close just closes, since
// the draft is already saved.
import { useRef, useState } from 'react';
import { ErrorBanner } from '@/components/admin/ErrorBanner';
import {
  type Backup,
  clearBackup,
  type SaveFn,
  sendJson,
  useAutosave,
} from '@/lib/client/autosave';
import { invalidateJson } from '@/lib/client/cachedJson';
import type { AdminMessageRow, AdminMessageTemplateRow } from '@/lib/db';
import { AutosaveStatus } from './AutosaveStatus';
import {
  emptyDraft,
  hasContent,
  MessageComposer,
  type MessageDraft,
  messageFields,
} from './MessageComposer';
import type { GrantablePerson } from './SopAccessPicker';

/** Where a new message's local backup lives, per admin on a shared browser. */
export function newMessageBackupKey(email: string): string {
  return `message:new:${email}`;
}

/** What the backup remembers beside the form: the draft it's saving into. */
export interface NewMessageMeta {
  id: string | null;
  updatedAt: string | null;
}

type Saved = { message: AdminMessageRow };

export function NewMessageComposer({
  staff,
  templates,
  viewerEmail,
  restored,
  onClose,
}: {
  staff: GrantablePerson[];
  templates?: AdminMessageTemplateRow[];
  viewerEmail: string;
  /** What was being typed last time, if it never reached the server. */
  restored: Backup<MessageDraft> | null;
  onClose: () => void;
}) {
  const backupKey = newMessageBackupKey(viewerEmail);
  const meta = (restored?.meta ?? null) as NewMessageMeta | null;
  const idRef = useRef<string | null>(meta?.id ?? null);
  const baseRef = useRef<string | null>(meta?.updatedAt ?? null);
  // Set by "Keep mine" after a conflict: the next save overwrites.
  const forceRef = useRef(false);
  const [initial] = useState<MessageDraft>(() =>
    restored ? { ...emptyDraft(), ...restored.value } : emptyDraft()
  );
  const [draft, setDraft] = useState<MessageDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save: SaveFn<MessageDraft> = async (d, { keepalive }) => {
    if (!idRef.current) {
      // An empty form isn't a draft yet. And a create can't go out with the
      // page closing — its id would never come back, and the backup would
      // make a second one next visit.
      if (!hasContent(d) || keepalive) return 'skipped';
      const { message } = await sendJson<Saved>('/api/admin/messages', 'POST', {
        ...messageFields(d),
        draft: true,
        sharedWith: d.sharedWith,
      });
      idRef.current = message.id;
      baseRef.current = message.updated_at;
      invalidateJson('/api/admin/messages');
      return 'saved';
    }
    const { message } = await sendJson<Saved>(
      '/api/admin/messages',
      'PATCH',
      {
        id: idRef.current,
        ...messageFields(d),
        sharedWith: d.sharedWith,
        ...(forceRef.current ? {} : { expectedUpdatedAt: baseRef.current }),
      },
      { keepalive }
    );
    forceRef.current = false;
    baseRef.current = message.updated_at;
    return 'saved';
  };

  const autosave = useAutosave<MessageDraft>({
    value: draft,
    save,
    backupKey,
    meta: { id: idRef.current, updatedAt: baseRef.current } satisfies NewMessageMeta,
    initialDirty: restored !== null,
  });

  const finish = (href: string) => {
    clearBackup(backupKey);
    invalidateJson('/api/admin/messages');
    window.location.assign(href);
  };

  const send = async (d: MessageDraft) => {
    setBusy(true);
    setError(null);
    try {
      await autosave.flush();
      const result = idRef.current
        ? await sendJson<Saved>('/api/admin/messages', 'PATCH', {
            id: idRef.current,
            ...messageFields(d),
            send: true,
            email: d.email,
            ...(forceRef.current ? {} : { expectedUpdatedAt: baseRef.current }),
          })
        : await sendJson<Saved>('/api/admin/messages', 'POST', {
            ...messageFields(d),
            email: d.email,
          });
      autosave.markSaved(d);
      finish(`/admin/messages/${result.message.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send');
      setBusy(false);
    }
  };

  const saveDraft = async () => {
    setBusy(true);
    setError(null);
    const saved = await autosave.flush();
    if (saved && idRef.current) {
      finish(`/admin/messages/${idRef.current}`);
      return;
    }
    setError("Couldn't save the draft yet. What you've written is kept on this device.");
    setBusy(false);
  };

  const close = async () => {
    setBusy(true);
    // Whatever is pending goes to the server first; if it can't, the backup
    // keeps it and the composer reopens with it next visit.
    const saved = await autosave.flush();
    if (saved) clearBackup(backupKey);
    invalidateJson('/api/admin/messages');
    setBusy(false);
    onClose();
  };

  return (
    <section className="rounded border border-white/10 bg-white/5 p-4">
      <h2 className="mb-3 font-mono text-[10px] font-bold uppercase tracking-wide text-white/40">
        New message
      </h2>
      {restored && (
        <p className="mb-3 font-mono text-[10px] text-white/50">Picked up where you left off.</p>
      )}
      {error && (
        <div className="mb-3">
          <ErrorBanner>{error}</ErrorBanner>
        </div>
      )}
      <MessageComposer
        initial={initial}
        staff={staff}
        busy={busy}
        submitLabel="Send"
        offerEmail
        authorEmail={viewerEmail}
        templates={templates}
        cancelLabel="Close"
        onChange={setDraft}
        onSubmit={(d) => void send(d)}
        onSaveDraft={() => void saveDraft()}
        onCancel={() => void close()}
        status={
          <AutosaveStatus
            state={autosave}
            savedLabel="Saved to Drafts"
            cleanHint="Saves as a private draft as you type."
            localHint="Kept on this device until there's something to save."
            onKeepMine={() => {
              forceRef.current = true;
              autosave.retry();
            }}
            onUseTheirs={() => {
              if (!idRef.current) return;
              autosave.markSaved(draft);
              finish(`/admin/messages/${idRef.current}`);
            }}
          />
        }
      />
    </section>
  );
}

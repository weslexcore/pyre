// Editing a message on its page (/admin/messages/[id]), with autosave
// (lib/client/autosave) that depends on whether it has gone out:
//
//   * A draft saves to the server as it's typed — it's only visible to its
//     author and collaborators, so a half-finished edit harms nobody. Each
//     save carries the version it started from; if a collaborator saved in
//     between, autosave stops and offers to keep this version or take theirs.
//     Done closes the editor; Send sends it.
//   * A sent message is already in front of staff, and widening its audience
//     notifies people. So its edits are kept on this device as they're typed
//     — surviving a closed tab — and reach the server only on Save.
//
// Either way the local backup reopens the editor with what was typed if the
// person comes back before it was saved (MessageThread checks on load).
import { useRef, useState } from 'react';
import { confirmAction } from '@/components/admin/ConfirmDialog';
import { ErrorBanner } from '@/components/admin/ErrorBanner';
import {
  AutosaveConflict,
  type Backup,
  clearBackup,
  type SaveFn,
  sendJson,
  useAutosave,
} from '@/lib/client/autosave';
import { invalidateJson } from '@/lib/client/cachedJson';
import type { AdminMessageRow } from '@/lib/db';
import { isDraft } from '@/lib/messages/access';
import type { PeopleNames } from '@/lib/sops/names';
import { AutosaveStatus } from './AutosaveStatus';
import { MessageComposer, type MessageDraft, messageFields } from './MessageComposer';
import { buttonClass } from './messagesUi';
import type { GrantablePerson } from './SopAccessPicker';

export function messageEditBackupKey(id: string): string {
  return `message:edit:${id}`;
}

/** The form a message opens into. */
export function draftOfMessage(message: AdminMessageRow): MessageDraft {
  return {
    title: message.title,
    bodyMd: message.body_md,
    audience: { roles: message.audience_roles, emails: message.audience_emails },
    pinned: message.pinned,
    // A draft hasn't been emailed yet, so sending it from here offers it.
    email: isDraft(message),
    sharedWith: message.shared_with,
  };
}

/** What the backup remembers beside the form: the version the edit started from. */
interface EditMeta {
  updatedAt: string;
}

type Saved = { message: AdminMessageRow; people: PeopleNames };

export function MessageEditor({
  message,
  staff,
  restored,
  onDone,
}: {
  message: AdminMessageRow;
  staff: GrantablePerson[];
  restored: Backup<MessageDraft> | null;
  /** The editor closed; `latest` is the row as the server now has it. */
  onDone: (latest: AdminMessageRow, people: PeopleNames) => void;
}) {
  const unsent = isDraft(message);
  const backupKey = messageEditBackupKey(message.id);
  const restoredMeta = (restored?.meta ?? null) as EditMeta | null;
  const baseRef = useRef(restoredMeta?.updatedAt ?? message.updated_at);
  const latestRef = useRef<{ message: AdminMessageRow; people: PeopleNames }>({
    message,
    people: {},
  });
  const forceRef = useRef(false);
  const [initial] = useState<MessageDraft>(() =>
    restored ? { ...draftOfMessage(message), ...restored.value } : draftOfMessage(message)
  );
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A sent message's Save refused as stale: offer to save over it.
  const [saveConflict, setSaveConflict] = useState(false);

  const patchBody = (d: MessageDraft) => ({
    id: message.id,
    ...messageFields(d),
    ...(unsent ? { sharedWith: d.sharedWith } : {}),
    ...(forceRef.current ? {} : { expectedUpdatedAt: baseRef.current }),
  });

  const saved = (data: Saved) => {
    forceRef.current = false;
    baseRef.current = data.message.updated_at;
    latestRef.current = {
      message: data.message,
      people: { ...latestRef.current.people, ...data.people },
    };
    invalidateJson('/api/admin/messages');
  };

  const save: SaveFn<MessageDraft> | null = unsent
    ? async (d, { keepalive }) => {
        saved(await sendJson<Saved>('/api/admin/messages', 'PATCH', patchBody(d), { keepalive }));
        return 'saved';
      }
    : null;

  const autosave = useAutosave<MessageDraft>({
    value,
    save,
    backupKey,
    meta: { updatedAt: baseRef.current } satisfies EditMeta,
    initialDirty: restored !== null,
  });

  /** Draft: everything pending reaches the server, then the editor closes. */
  const done = async () => {
    setBusy(true);
    setError(null);
    if (await autosave.flush()) {
      onDone(latestRef.current.message, latestRef.current.people);
      return;
    }
    setError("Couldn't save yet. Your changes are kept on this device.");
    setBusy(false);
  };

  const send = async (d: MessageDraft) => {
    setBusy(true);
    setError(null);
    try {
      await autosave.flush();
      await sendJson<Saved>('/api/admin/messages', 'PATCH', {
        ...patchBody(d),
        send: true,
        email: d.email,
      });
      autosave.markSaved(d);
      clearBackup(backupKey);
      invalidateJson('/api/admin/messages');
      // Reload so the page picks up who it was emailed to and opens the thread.
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send');
      setBusy(false);
    }
  };

  /** Sent message: publish the edit. */
  const saveSent = async (d: MessageDraft) => {
    setBusy(true);
    setError(null);
    setSaveConflict(false);
    try {
      saved(await sendJson<Saved>('/api/admin/messages', 'PATCH', patchBody(d)));
      autosave.markSaved(d);
      onDone(latestRef.current.message, latestRef.current.people);
    } catch (e) {
      if (e instanceof AutosaveConflict) setSaveConflict(true);
      setError(e instanceof Error ? e.message : 'Failed to save');
      setBusy(false);
    }
  };

  const cancelSent = async () => {
    if (
      JSON.stringify(value) !== JSON.stringify(draftOfMessage(message)) &&
      !(await confirmAction({
        title: 'Discard your changes?',
        confirmLabel: 'Discard',
        danger: true,
      }))
    ) {
      return;
    }
    autosave.markSaved(value);
    onDone(latestRef.current.message, latestRef.current.people);
  };

  return (
    <div className="space-y-3">
      {restored && (
        <p className="font-mono text-[10px] text-white/50">
          Picked up your unsaved changes from last time.
        </p>
      )}
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {saveConflict && (
        <button
          type="button"
          className={buttonClass}
          disabled={busy}
          onClick={() => {
            forceRef.current = true;
            void saveSent(value);
          }}
        >
          Save mine anyway
        </button>
      )}
      <MessageComposer
        initial={initial}
        staff={staff}
        busy={busy}
        submitLabel={unsent ? 'Send' : 'Save'}
        offerEmail={unsent}
        authorEmail={message.author_email}
        draftLabel="Done"
        onChange={setValue}
        onSubmit={(d) => void (unsent ? send(d) : saveSent(d))}
        onSaveDraft={unsent ? () => void done() : undefined}
        onCancel={unsent ? undefined : () => void cancelSent()}
        status={
          <AutosaveStatus
            state={autosave}
            cleanHint={unsent ? 'Saves as you type.' : undefined}
            localHint="Unsaved changes are kept on this device. Save to publish them."
            onKeepMine={() => {
              forceRef.current = true;
              autosave.retry();
            }}
            onUseTheirs={() => {
              autosave.markSaved(value);
              window.location.reload();
            }}
          />
        }
      />
    </div>
  );
}

// /admin/messages/templates: the message templates admins start messages
// from — a weekly update, a closing notice. Each has a name for the picker
// and the title, body, audience, and pin a new message starts with; the
// title and body may hold date placeholders, filled in when the template is
// used. Admin-only (the page and /api/admin/message-templates both check).
//
// The editor autosaves (lib/client/autosave): once a template has a name, a
// title, a body, and an audience it is saved as it's typed; until then — and
// whenever a save can't land — what's typed is kept on this device, and the
// editor reopens with it on the next visit. Saves carry the version they
// started from, so two admins editing one template can't overwrite each
// other unawares.
import { useEffect, useRef, useState } from 'react';
import { confirmAction } from '@/components/admin/ConfirmDialog';
import { ErrorBanner } from '@/components/admin/ErrorBanner';
import { compactInputClass, goldButtonClass } from '@/components/admin/ui';
import { readError } from '@/lib/client/api';
import {
  type Backup,
  backupKeys,
  clearBackup,
  readBackup,
  type SaveFn,
  sendJson,
  useAutosave,
} from '@/lib/client/autosave';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import { etStamp } from '@/lib/client/format';
import type { AdminMessageTemplateRow } from '@/lib/db';
import { TEMPLATE_NAME_MAX, TEMPLATE_PLACEHOLDERS } from '@/lib/messages/templates';
import { excerpt } from '@/lib/notifications/types';
import { describeGrants } from '@/lib/sops/levels';
import { type PeopleNames, personName } from '@/lib/sops/names';
import { AutosaveStatus } from './AutosaveStatus';
import { BackLink } from './BackLink';
import { emptyDraft, MessageComposer, type MessageDraft, messageFields } from './MessageComposer';
import { chipClass } from './messagesUi';
import type { GrantablePerson } from './SopAccessPicker';

const TEMPLATES_URL = '/api/admin/message-templates';
const BACKUP_PREFIX = 'template:';
const NEW_KEY = `${BACKUP_PREFIX}new`;

/** What the editor holds: the template's name plus the message form. */
interface TemplateValue {
  name: string;
  draft: MessageDraft;
}

/** What the backup remembers beside the form: the template it's saving into. */
interface TemplateMeta {
  id: string | null;
  updatedAt: string | null;
}

/** Which template the editor is open on, and what to restore into it. */
type Editing =
  | { kind: 'new'; restored?: Backup<TemplateValue> }
  | { kind: 'edit'; template: AdminMessageTemplateRow; restored?: Backup<TemplateValue> }
  | null;

function draftOf(template: AdminMessageTemplateRow): MessageDraft {
  return {
    ...emptyDraft(),
    title: template.title,
    bodyMd: template.body_md,
    audience: { roles: template.audience_roles, emails: template.audience_emails },
    pinned: template.pinned,
  };
}

/** Whether the server would take it: every required field filled. */
function complete({ name, draft }: TemplateValue): boolean {
  return (
    name.trim().length > 0 &&
    draft.title.trim().length > 0 &&
    draft.bodyMd.trim().length > 0 &&
    draft.audience.roles.length + draft.audience.emails.length > 0
  );
}

function TemplateEditor({
  editing,
  staff,
  onSaved,
  onClose,
}: {
  editing: NonNullable<Editing>;
  staff: GrantablePerson[];
  /** A save landed — the list should show it. */
  onSaved: () => void;
  onClose: () => void;
}) {
  const existing = editing.kind === 'edit' ? editing.template : null;
  const restored = editing.restored ?? null;
  const meta = (restored?.meta ?? null) as TemplateMeta | null;
  const backupKey = existing ? `${BACKUP_PREFIX}${existing.id}` : NEW_KEY;
  const idRef = useRef<string | null>(existing?.id ?? meta?.id ?? null);
  const baseRef = useRef<string | null>(meta?.updatedAt ?? existing?.updated_at ?? null);
  const forceRef = useRef(false);
  const [initial] = useState<TemplateValue>(() => {
    const base = { name: existing?.name ?? '', draft: existing ? draftOf(existing) : emptyDraft() };
    return restored
      ? {
          name: restored.value.name ?? base.name,
          draft: { ...base.draft, ...restored.value.draft },
        }
      : base;
  });
  const [name, setName] = useState(initial.name);
  const [draft, setDraft] = useState(initial.draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save: SaveFn<TemplateValue> = async (value, { keepalive }) => {
    if (!complete(value)) return 'skipped';
    const fields = { name: value.name, ...messageFields(value.draft) };
    if (!idRef.current) {
      // A create can't go out with the page closing: its id would be lost.
      if (keepalive) return 'skipped';
      const { template } = await sendJson<{ template: AdminMessageTemplateRow }>(
        TEMPLATES_URL,
        'POST',
        fields
      );
      idRef.current = template.id;
      baseRef.current = template.updated_at;
      onSaved();
      return 'saved';
    }
    const { template } = await sendJson<{ template: AdminMessageTemplateRow }>(
      TEMPLATES_URL,
      'PATCH',
      {
        id: idRef.current,
        ...fields,
        ...(forceRef.current ? {} : { expectedUpdatedAt: baseRef.current }),
      },
      { keepalive }
    );
    forceRef.current = false;
    baseRef.current = template.updated_at;
    if (!keepalive) onSaved();
    return 'saved';
  };

  const value: TemplateValue = { name, draft };
  const autosave = useAutosave<TemplateValue>({
    value,
    save,
    backupKey,
    meta: { id: idRef.current, updatedAt: baseRef.current } satisfies TemplateMeta,
    initialDirty: restored !== null,
  });

  const done = async () => {
    setBusy(true);
    setError(null);
    if (await autosave.flush()) {
      onClose();
      return;
    }
    setError("Couldn't save yet. What you've written is kept on this device.");
    setBusy(false);
  };

  /** A new template that never reached the server can be thrown away. */
  const discard = async () => {
    const typed = name.trim().length > 0 || draft.title.trim() || draft.bodyMd.trim();
    if (
      typed &&
      !(await confirmAction({
        title: 'Discard this template?',
        confirmLabel: 'Discard',
        danger: true,
      }))
    ) {
      return;
    }
    autosave.markSaved(value);
    clearBackup(backupKey);
    onClose();
  };

  /** An existing template: close now; anything unsaved stays on this device. */
  const close = async () => {
    setBusy(true);
    await autosave.flush();
    onClose();
  };

  return (
    <section className="space-y-3 rounded border border-white/10 bg-white/5 p-4">
      <h2 className="font-mono text-[10px] font-bold uppercase tracking-wide text-white/40">
        {existing ? `Edit ${existing.name}` : 'New template'}
      </h2>
      {restored && (
        <p className="font-mono text-[10px] text-white/50">
          Picked up your unsaved changes from last time.
        </p>
      )}
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <input
        type="text"
        className={`${compactInputClass} w-full`}
        placeholder="Template name, e.g. Weekly update"
        maxLength={TEMPLATE_NAME_MAX}
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Template name"
        required
      />
      <div className="rounded border border-white/10 px-3 py-2 font-mono text-[10px] text-white/40">
        <p className="mb-1 uppercase tracking-wide">
          Placeholders, filled in when someone uses the template
        </p>
        <ul className="space-y-0.5">
          {TEMPLATE_PLACEHOLDERS.map((p) => (
            <li key={p.token}>
              <code className="text-[var(--pyre-creme)]">{p.token}</code> {p.label}
            </li>
          ))}
        </ul>
      </div>
      <MessageComposer
        initial={initial.draft}
        staff={staff}
        busy={busy}
        submitLabel="Done"
        submitDisabled={name.trim().length === 0}
        cancelLabel={idRef.current ? 'Close' : 'Discard'}
        onChange={setDraft}
        onSubmit={() => void done()}
        onCancel={() => void (idRef.current ? close() : discard())}
        status={
          <AutosaveStatus
            state={autosave}
            cleanHint="Saves as you type."
            localHint="Kept on this device until it has a name, title, message, and audience."
            onKeepMine={() => {
              forceRef.current = true;
              autosave.retry();
            }}
            onUseTheirs={() => {
              autosave.markSaved(value);
              onSaved();
              onClose();
            }}
          />
        }
      />
    </section>
  );
}

export function MessageTemplates() {
  const feed = useCachedJson<{ templates: AdminMessageTemplateRow[]; people: PeopleNames }>(
    TEMPLATES_URL
  );
  const people = feed.data?.people ?? {};
  // The roster for the audience picker rides on the admin messages list.
  const roster = useCachedJson<{ staff?: GrantablePerson[] }>('/api/admin/messages');
  const staff = roster.data?.staff ?? [];
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const templates = feed.data?.templates ?? [];

  // A template left mid-edit on this device reopens with what was typed.
  const backupChecked = useRef(false);
  useEffect(() => {
    if (backupChecked.current || !feed.data) return;
    backupChecked.current = true;
    const fresh = readBackup<TemplateValue>(NEW_KEY);
    if (fresh) {
      setEditing({ kind: 'new', restored: fresh });
      return;
    }
    for (const key of backupKeys(BACKUP_PREFIX)) {
      const template = feed.data.templates.find((t) => key === `${BACKUP_PREFIX}${t.id}`);
      const backup = readBackup<TemplateValue>(key);
      if (!template || !backup) {
        clearBackup(key); // its template was deleted
        continue;
      }
      setEditing({ kind: 'edit', template, restored: backup });
      return;
    }
  }, [feed.data]);

  const refresh = () => {
    invalidateJson(TEMPLATES_URL);
    void feed.reload();
  };

  const edit = (template: AdminMessageTemplateRow) =>
    setEditing({
      kind: 'edit',
      template,
      restored: readBackup<TemplateValue>(`${BACKUP_PREFIX}${template.id}`) ?? undefined,
    });

  const remove = async (template: AdminMessageTemplateRow) => {
    if (
      !(await confirmAction({
        title: `Delete the "${template.name}" template?`,
        body: 'Messages already written from it stay as they are.',
        confirmLabel: 'Delete',
        danger: true,
      }))
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${TEMPLATES_URL}?id=${encodeURIComponent(template.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(await readError(res));
      clearBackup(`${BACKUP_PREFIX}${template.id}`);
      invalidateJson(TEMPLATES_URL);
      await feed.reload();
      if (editing?.kind === 'edit' && editing.template.id === template.id) setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete the template');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <BackLink href="/admin/messages">All messages</BackLink>
        {!editing && (
          <button
            type="button"
            className={`${goldButtonClass} ml-auto`}
            onClick={() => setEditing({ kind: 'new' })}
          >
            New template
          </button>
        )}
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {editing && (
        <TemplateEditor
          key={editing.kind === 'edit' ? editing.template.id : 'new'}
          editing={editing}
          staff={staff}
          onSaved={refresh}
          onClose={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}

      {feed.error && !feed.data && (
        <p role="alert" className="text-sm text-[var(--pyre-red)]">
          Couldn't load templates: {feed.error}
        </p>
      )}

      {feed.loading ? (
        <p className="py-8 text-center text-sm text-white/40">Loading…</p>
      ) : templates.length === 0 ? (
        <p className="py-8 text-center text-sm text-white/40">
          No templates yet. Make one for a message you write often, like a weekly update.
        </p>
      ) : (
        <ul className="space-y-2">
          {templates.map((t) => (
            <li key={t.id} className="rounded border border-white/10 px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-base font-semibold text-[var(--pyre-creme)]">{t.name}</span>
                {t.pinned && (
                  <span
                    className={`${chipClass} border-[var(--pyre-gold)]/50 text-[var(--pyre-gold)]`}
                  >
                    Pins
                  </span>
                )}
                <span className="ml-auto flex gap-3 font-mono text-[10px] uppercase tracking-wide text-white/40">
                  <button
                    type="button"
                    className="hover:text-white"
                    disabled={busy}
                    onClick={() => edit(t)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="hover:text-[var(--pyre-red)]"
                    disabled={busy}
                    onClick={() => void remove(t)}
                  >
                    Delete
                  </button>
                </span>
              </div>
              <p className="mt-1 text-sm text-white/70">{t.title}</p>
              <p className="mt-1 line-clamp-2 text-sm text-white/50">{excerpt(t.body_md, 220)}</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-white/40">
                <span>to {describeGrants(t.audience_roles, t.audience_emails)}</span>
                <span className="ml-auto">
                  {t.updated_by
                    ? `edited by ${personName(t.updated_by, people)} · ${etStamp(t.updated_at)}`
                    : `made by ${personName(t.created_by, people)} · ${etStamp(t.created_at)}`}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

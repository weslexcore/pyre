// /admin/messages/templates: the message templates admins start messages
// from — a weekly update, a closing notice. Each has a name for the picker
// and the title, body, audience, and pin a new message starts with; the
// title and body may hold date placeholders, filled in when the template is
// used. Admin-only (the page and /api/admin/message-templates both check).
import { useState } from 'react';
import { confirmAction } from '@/components/admin/ConfirmDialog';
import { ErrorBanner } from '@/components/admin/ErrorBanner';
import { compactInputClass, goldButtonClass } from '@/components/admin/ui';
import { readError } from '@/lib/client/api';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import { etStamp } from '@/lib/client/format';
import type { AdminMessageTemplateRow } from '@/lib/db';
import { TEMPLATE_NAME_MAX, TEMPLATE_PLACEHOLDERS } from '@/lib/messages/templates';
import { excerpt } from '@/lib/notifications/types';
import { describeGrants } from '@/lib/sops/levels';
import { type PeopleNames, personName } from '@/lib/sops/names';
import { BackLink } from './BackLink';
import { emptyDraft, MessageComposer, type MessageDraft } from './MessageComposer';
import { chipClass } from './messagesUi';
import type { GrantablePerson } from './SopAccessPicker';

const TEMPLATES_URL = '/api/admin/message-templates';

/** Which template the editor is open on: a new one, or an existing id. */
type Editing = { kind: 'new' } | { kind: 'edit'; template: AdminMessageTemplateRow } | null;

function draftOf(template: AdminMessageTemplateRow): MessageDraft {
  return {
    ...emptyDraft(),
    title: template.title,
    bodyMd: template.body_md,
    audience: { roles: template.audience_roles, emails: template.audience_emails },
    pinned: template.pinned,
  };
}

function TemplateEditor({
  editing,
  staff,
  busy,
  onSave,
  onCancel,
}: {
  editing: NonNullable<Editing>;
  staff: GrantablePerson[];
  busy: boolean;
  onSave: (name: string, draft: MessageDraft) => void;
  onCancel: () => void;
}) {
  const existing = editing.kind === 'edit' ? editing.template : null;
  const [name, setName] = useState(existing?.name ?? '');

  return (
    <section className="space-y-3 rounded border border-white/10 bg-white/5 p-4">
      <h2 className="font-mono text-[10px] font-bold uppercase tracking-wide text-white/40">
        {existing ? `Edit ${existing.name}` : 'New template'}
      </h2>
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
        initial={existing ? draftOf(existing) : emptyDraft()}
        staff={staff}
        busy={busy}
        submitLabel={existing ? 'Save template' : 'Create template'}
        submitDisabled={name.trim().length === 0}
        onSubmit={(draft) => onSave(name, draft)}
        onCancel={onCancel}
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

  const save = async (name: string, draft: MessageDraft) => {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(TEMPLATES_URL, {
        method: editing.kind === 'new' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(editing.kind === 'edit' ? { id: editing.template.id } : {}),
          name,
          title: draft.title,
          bodyMd: draft.bodyMd,
          audienceRoles: draft.audience.roles,
          audienceEmails: draft.audience.emails,
          pinned: draft.pinned,
        }),
      });
      if (!res.ok) throw new Error(await readError(res));
      invalidateJson(TEMPLATES_URL);
      await feed.reload();
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save the template');
    } finally {
      setBusy(false);
    }
  };

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
          busy={busy}
          onSave={(name, draft) => void save(name, draft)}
          onCancel={() => setEditing(null)}
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
                    onClick={() => setEditing({ kind: 'edit', template: t })}
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

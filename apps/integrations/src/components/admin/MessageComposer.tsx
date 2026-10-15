// Writing (or editing) an admin message: a title, a markdown body with a
// live preview through the same renderer the SOP library uses, the audience
// picker the SOP access settings use, a pin toggle, and — for a new message —
// whether to email it to the audience too (on by default). Admin-only by the
// routes; the parent decides what "save" means (create or update).
import { useState } from 'react';
import { compactInputClass, goldButtonClass } from '@/components/admin/ui';
import { roleIsNotified } from '@/lib/messages/access';
import { BODY_MAX, TITLE_MAX } from '@/lib/messages/validate';
import type { SopRole } from '@/lib/sops/levels';
import { LinkTextarea } from './LinkTextarea';
import { buttonClass, textareaClass } from './messagesUi';
import {
  type GrantablePerson,
  SopAccessPicker,
  type SopGrant,
  withAdmins,
} from './SopAccessPicker';
import { SopMarkdown } from './SopMarkdown';

export interface MessageDraft {
  title: string;
  bodyMd: string;
  audience: SopGrant;
  pinned: boolean;
  /** Also email it to everyone it reaches; only a new message offers this. */
  email: boolean;
}

export const EVERYONE: SopRole[] = ['staff', 'shift_lead', 'admin'];

export function emptyDraft(): MessageDraft {
  return {
    title: '',
    bodyMd: '',
    audience: { roles: EVERYONE.slice(), emails: [] },
    pinned: false,
    email: true,
  };
}

export function MessageComposer({
  initial,
  staff,
  busy,
  submitLabel,
  offerEmail = false,
  onSubmit,
  onCancel,
}: {
  initial: MessageDraft;
  /** The roster the audience picker offers (admins get it from the API). */
  staff: GrantablePerson[];
  busy: boolean;
  submitLabel: string;
  /** Show the "also email" switch (new messages only; edits never re-send). */
  offerEmail?: boolean;
  onSubmit: (draft: MessageDraft) => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<MessageDraft>(initial);
  const [preview, setPreview] = useState(false);
  const canSubmit = draft.title.trim().length > 0 && draft.bodyMd.trim().length > 0 && !busy;
  // Who a new message will ping, by the same rule the server fans out with.
  const sent = {
    audience_roles: withAdmins(draft.audience.roles),
    audience_emails: draft.audience.emails,
  };
  const reached = staff.filter(
    (person) => roleIsNotified(sent, person.role) || sent.audience_emails.includes(person.email)
  );

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit)
          onSubmit({
            ...draft,
            audience: { ...draft.audience, roles: withAdmins(draft.audience.roles) },
          });
      }}
    >
      <input
        type="text"
        className={`${compactInputClass} w-full`}
        placeholder="Title"
        maxLength={TITLE_MAX}
        value={draft.title}
        onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
        aria-label="Message title"
        required
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          className={`${buttonClass} ${!preview ? 'border-white/40 text-white' : ''}`}
          aria-pressed={!preview}
          onClick={() => setPreview(false)}
        >
          Write
        </button>
        <button
          type="button"
          className={`${buttonClass} ${preview ? 'border-white/40 text-white' : ''}`}
          aria-pressed={preview}
          onClick={() => setPreview(true)}
        >
          Preview
        </button>
        <span className="ml-auto font-mono text-[10px] text-white/30">markdown</span>
      </div>

      {preview ? (
        <div className="min-h-[160px] rounded border border-white/10 bg-white/5 px-4 py-3">
          {draft.bodyMd.trim() ? (
            <SopMarkdown content={draft.bodyMd} />
          ) : (
            <p className="text-sm text-white/30">Nothing to preview yet.</p>
          )}
        </div>
      ) : (
        <LinkTextarea
          className={textareaClass}
          placeholder="Write the message in markdown… type [name](/ to link a page or SOP"
          maxLength={BODY_MAX}
          value={draft.bodyMd}
          onChange={(bodyMd) => setDraft((d) => ({ ...d, bodyMd }))}
          aria-label="Message body"
          required
        />
      )}

      <SopAccessPicker
        title="Who sees this"
        hint="Everyone with a granted role, plus anyone named."
        grant={draft.audience}
        staff={staff}
        disabled={busy}
        onChange={(audience) => setDraft((d) => ({ ...d, audience }))}
      />

      {offerEmail && (
        <p className="font-mono text-[10px] text-white/40">
          {reached.length === 0
            ? 'Nobody will be notified yet.'
            : `${draft.email ? 'Notifies and emails' : 'Notifies'} ${reached.length}: ${reached
                .map((person) => person.name)
                .join(', ')}`}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={goldButtonClass} disabled={!canSubmit}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className={buttonClass} disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        )}
        {offerEmail && (
          <label className="ml-auto flex cursor-pointer items-center gap-2 font-mono text-[10px] uppercase tracking-wide text-white/40">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-[var(--pyre-gold)]"
              checked={draft.email}
              disabled={busy}
              onChange={(e) => setDraft((d) => ({ ...d, email: e.target.checked }))}
            />
            also email
          </label>
        )}
        <label
          className={`${offerEmail ? '' : 'ml-auto '}flex cursor-pointer items-center gap-2 font-mono text-[10px] uppercase tracking-wide text-white/40`}
        >
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-[var(--pyre-gold)]"
            checked={draft.pinned}
            disabled={busy}
            onChange={(e) => setDraft((d) => ({ ...d, pinned: e.target.checked }))}
          />
          pin to top
        </label>
      </div>
    </form>
  );
}

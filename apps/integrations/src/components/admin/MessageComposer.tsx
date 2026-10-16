// Writing (or editing) an admin message: a title, a markdown body with a
// live preview through the same renderer the SOP library uses, the audience
// picker the SOP access settings use, a pin toggle, and — for a new message —
// whether to email it to the audience too (on by default). A message that
// hasn't gone out yet can also be saved as a draft, kept private or shared
// with other admins to work on together. A new message can start from a
// template (lib/messages/templates fills its date placeholders); the
// template editor reuses this form too. Admin-only by the routes; the parent
// decides what "save" and "save draft" mean (create or update), and hears
// every change (onChange) so it can autosave (lib/client/autosave).
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { confirmAction } from '@/components/admin/ConfirmDialog';
import { compactInputClass, goldButtonClass } from '@/components/admin/ui';
import type { AdminMessageTemplateRow } from '@/lib/db';
import { roleIsNotified } from '@/lib/messages/access';
import { fillPlaceholders } from '@/lib/messages/templates';
import { BODY_MAX, TITLE_MAX } from '@/lib/messages/validate';
import type { SopRole } from '@/lib/sops/levels';
import { LinkTextarea } from './LinkTextarea';
import { buttonClass, textareaClass } from './messagesUi';
import { type GrantablePerson, SopAccessPicker, type SopGrant } from './SopAccessPicker';
import { SopMarkdown } from './SopMarkdown';

export interface MessageDraft {
  title: string;
  bodyMd: string;
  audience: SopGrant;
  pinned: boolean;
  /** Also email it to everyone it reaches; only a new message offers this. */
  email: boolean;
  /** Admins the draft is shared with besides its author; empty = private. */
  sharedWith: string[];
}

export const EVERYONE: SopRole[] = ['staff', 'shift_lead', 'admin'];

/** Whether anything has been written yet (an empty form isn't worth saving). */
export function hasContent(draft: MessageDraft): boolean {
  return draft.title.trim().length > 0 || draft.bodyMd.trim().length > 0;
}

/** The message fields of a draft as the messages API takes them. */
export function messageFields(draft: MessageDraft) {
  return {
    title: draft.title,
    bodyMd: draft.bodyMd,
    audienceRoles: draft.audience.roles,
    audienceEmails: draft.audience.emails,
    pinned: draft.pinned,
  };
}

/** A template copied into a fresh message, its placeholders filled for today. */
export function draftFromTemplate(
  template: AdminMessageTemplateRow,
  base: MessageDraft
): MessageDraft {
  return {
    ...base,
    title: fillPlaceholders(template.title),
    bodyMd: fillPlaceholders(template.body_md),
    audience: { roles: template.audience_roles.slice(), emails: template.audience_emails.slice() },
    pinned: template.pinned,
  };
}

export function emptyDraft(): MessageDraft {
  return {
    title: '',
    bodyMd: '',
    audience: { roles: EVERYONE.slice(), emails: [] },
    pinned: false,
    email: true,
    sharedWith: [],
  };
}

const checkboxClass = 'h-3.5 w-3.5 shrink-0 accent-[var(--pyre-gold)] cursor-pointer';

/** Which admins can open and edit the draft alongside its author. */
function DraftSharingPicker({
  admins,
  sharedWith,
  disabled,
  onChange,
}: {
  admins: GrantablePerson[];
  sharedWith: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  const toggle = (email: string) =>
    onChange(
      sharedWith.includes(email) ? sharedWith.filter((e) => e !== email) : [...sharedWith, email]
    );
  return (
    <fieldset className="rounded border border-white/10 bg-white/5 p-3">
      <legend className="px-1 font-mono text-[10px] uppercase tracking-wide text-white/40">
        Share draft with
      </legend>
      {admins.length === 0 ? (
        <p className="text-xs text-white/40">No other admins on the roster.</p>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {admins.map((person) => (
            <label
              key={person.email}
              className="flex cursor-pointer items-center gap-1.5 text-xs text-white/70"
            >
              <input
                type="checkbox"
                className={checkboxClass}
                checked={sharedWith.includes(person.email)}
                disabled={disabled}
                onChange={() => toggle(person.email)}
              />
              {person.name}
            </label>
          ))}
        </div>
      )}
      <p className="mt-2 font-mono text-[10px] text-white/30">
        {sharedWith.length === 0
          ? 'Private: only you can see this draft until it is sent.'
          : 'They can open and edit the draft, and send it. Nobody else sees it until it is sent.'}
      </p>
    </fieldset>
  );
}

export function MessageComposer({
  initial,
  staff,
  busy,
  submitLabel,
  offerEmail = false,
  authorEmail,
  templates,
  submitDisabled = false,
  draftLabel = 'Save draft',
  cancelLabel = 'Cancel',
  status,
  onChange,
  onSubmit,
  onSaveDraft,
  onCancel,
}: {
  initial: MessageDraft;
  /** The roster the audience picker offers (admins get it from the API). */
  staff: GrantablePerson[];
  busy: boolean;
  submitLabel: string;
  /** Show the "also email" switch (new messages only; edits never re-send). */
  offerEmail?: boolean;
  /** The draft's author — left out of the sharing picker, they always have it. */
  authorEmail?: string;
  /** Offer "Start from a template" (new messages only). */
  templates?: AdminMessageTemplateRow[];
  /** Hold the submit buttons off for a reason outside the form (a blank template name). */
  submitDisabled?: boolean;
  /** The label for the onSaveDraft button ("Save draft", or "Done" when it autosaves). */
  draftLabel?: string;
  cancelLabel?: string;
  /** Shown under the buttons — the autosave readout. */
  status?: ReactNode;
  /** Every change to the form, for autosave. */
  onChange?: (draft: MessageDraft) => void;
  onSubmit: (draft: MessageDraft) => void;
  /** Offer the draft button and the sharing picker (messages not yet sent). */
  onSaveDraft?: (draft: MessageDraft) => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<MessageDraft>(initial);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    onChangeRef.current?.(draft);
  }, [draft]);
  const [preview, setPreview] = useState(false);
  const hasAudience = draft.audience.roles.length > 0 || draft.audience.emails.length > 0;
  const canSubmit =
    draft.title.trim().length > 0 &&
    draft.bodyMd.trim().length > 0 &&
    hasAudience &&
    !busy &&
    !submitDisabled;

  const applyTemplate = async (id: string) => {
    const template = templates?.find((t) => t.id === id);
    if (!template) return;
    const written = draft.title.trim().length > 0 || draft.bodyMd.trim().length > 0;
    if (
      written &&
      !(await confirmAction({
        title: `Replace what you've written with "${template.name}"?`,
        confirmLabel: 'Replace',
      }))
    ) {
      return;
    }
    setDraft((d) => draftFromTemplate(template, d));
  };
  // Who a new message will ping, by the same rule the server fans out with.
  const sent = {
    audience_roles: draft.audience.roles,
    audience_emails: draft.audience.emails,
  };
  const reached = staff.filter(
    (person) => roleIsNotified(sent, person.role) || sent.audience_emails.includes(person.email)
  );
  const otherAdmins = staff.filter(
    (person) => person.role === 'admin' && person.email !== authorEmail
  );

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit(draft);
      }}
    >
      {templates && templates.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <label
            htmlFor="message-template"
            className="font-mono text-[10px] uppercase tracking-wide text-white/40"
          >
            Start from a template
          </label>
          <select
            id="message-template"
            className={compactInputClass}
            value=""
            disabled={busy}
            onChange={(e) => void applyTemplate(e.target.value)}
          >
            <option value="">Choose…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      )}

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
        title="Who it's for"
        hint="Everyone with a ticked role, plus anyone named. Admins can open every message either way."
        grant={draft.audience}
        staff={staff}
        disabled={busy}
        lockAdmins={false}
        onChange={(audience) => setDraft((d) => ({ ...d, audience }))}
      />

      {onSaveDraft && (
        <DraftSharingPicker
          admins={otherAdmins}
          sharedWith={draft.sharedWith}
          disabled={busy}
          onChange={(sharedWith) => setDraft((d) => ({ ...d, sharedWith }))}
        />
      )}

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
        {onSaveDraft && (
          // A draft may be incomplete, so only an empty form holds this off.
          <button
            type="button"
            className={buttonClass}
            disabled={busy || !hasContent(draft)}
            onClick={() => onSaveDraft(draft)}
          >
            {draftLabel}
          </button>
        )}
        {onCancel && (
          <button type="button" className={buttonClass} disabled={busy} onClick={onCancel}>
            {cancelLabel}
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
      {status}
    </form>
  );
}

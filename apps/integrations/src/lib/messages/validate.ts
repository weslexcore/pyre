// Field limits and normalisation for admin messages and their replies —
// mirrored by the table's check constraints, so a bad value is refused with
// a readable message before the insert ever runs. Client-bundle-safe: the
// composer uses the limits for maxLength.

import { normalizeEmail } from '@/lib/email/address';
import { isSopRole, type SopRole } from '@/lib/sops/levels';

export const TITLE_MAX = 200;
export const BODY_MAX = 20000;
export const REPLY_MAX = 4000;
export const AUDIENCE_EMAILS_MAX = 100;

/** Trimmed title, or '' when blank or over the limit. */
export function normalizeTitle(value: unknown): string {
  if (typeof value !== 'string') return '';
  const title = value.trim();
  return title.length > 0 && title.length <= TITLE_MAX ? title : '';
}

/**
 * Markdown body with surrounding blank lines dropped (indentation inside is
 * meaningful, so only the edges are trimmed), or '' when blank or over `max`.
 */
export function normalizeBody(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const body = value.replace(/^\s*\n/, '').replace(/\s+$/, '');
  return body.trim().length > 0 && body.length <= max ? body : '';
}

export interface Audience {
  roles: SopRole[];
  emails: string[];
}

/**
 * The audience a request body names. Roles must be SOP roles — admin is
 * optional: admins read every message regardless, so the role only decides
 * whether they're told — and at least one role or person must be named,
 * unless `allowEmpty` (a draft, which can be half set up); emails are
 * lowercased and deduped. Whether the emails are real roster members is the
 * route's check — it has the roster, this module doesn't.
 */
export function parseAudience(
  roles: unknown,
  emails: unknown,
  options: { allowEmpty?: boolean } = {}
): { ok: true; audience: Audience } | { ok: false; error: string } {
  if (!Array.isArray(roles) || !roles.every(isSopRole)) {
    return { ok: false, error: 'audienceRoles must be staff, shift_lead, or admin' };
  }
  if (!Array.isArray(emails) || !emails.every((e) => typeof e === 'string')) {
    return { ok: false, error: 'audienceEmails must be a list of emails' };
  }
  const uniqueRoles = [...new Set(roles as SopRole[])];
  const uniqueEmails = [...new Set((emails as string[]).map(normalizeEmail).filter(Boolean))];
  if (uniqueEmails.length > AUDIENCE_EMAILS_MAX) {
    return { ok: false, error: `audienceEmails may name at most ${AUDIENCE_EMAILS_MAX} people` };
  }
  if (!options.allowEmpty && uniqueRoles.length === 0 && uniqueEmails.length === 0) {
    return { ok: false, error: 'Pick at least one role or person' };
  }
  return { ok: true, audience: { roles: uniqueRoles, emails: uniqueEmails } };
}

/**
 * The admins a draft is shared with: lowercased, deduped, the author left
 * out (they always have it). Empty is valid — a private draft. Whether each
 * one is an admin on the roster is the route's check.
 */
export function parseSharedWith(
  value: unknown,
  author: string
): { ok: true; emails: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value) || !value.every((e) => typeof e === 'string')) {
    return { ok: false, error: 'sharedWith must be a list of emails' };
  }
  const emails = [...new Set((value as string[]).map(normalizeEmail).filter(Boolean))].filter(
    (email) => email !== author
  );
  if (emails.length > AUDIENCE_EMAILS_MAX) {
    return { ok: false, error: `sharedWith may name at most ${AUDIENCE_EMAILS_MAX} people` };
  }
  return { ok: true, emails };
}

/**
 * A draft's title as typed: trimmed, and allowed to be blank — drafts are
 * saved while still being written. Null when it isn't a string or is over
 * the limit.
 */
export function draftTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const title = value.trim();
  return title.length <= TITLE_MAX ? title : null;
}

/** A draft's markdown body, edges trimmed like normalizeBody but allowed blank. */
export function draftBody(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const body = value.replace(/^\s*\n/, '').replace(/\s+$/, '');
  return body.length <= BODY_MAX ? body : null;
}

/**
 * What stops this message going out, or null when it's ready: a sent
 * message needs a title, a body, and someone to send it to. Drafts may lack
 * any of them until then.
 */
export function sendProblem(message: {
  title: string;
  body_md: string;
  audience_roles: string[];
  audience_emails: string[];
}): string | null {
  if (message.title.trim().length === 0) return 'Give the message a title before sending it';
  if (message.body_md.trim().length === 0) return 'Write the message before sending it';
  if (message.audience_roles.length === 0 && message.audience_emails.length === 0) {
    return 'Pick at least one role or person to send it to';
  }
  return null;
}

/** A message's title for display: an untitled draft reads as one. */
export function displayTitle(message: { title: string }): string {
  return message.title.trim() || 'Untitled draft';
}

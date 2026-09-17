// Field limits and normalisation for admin messages and their replies —
// mirrored by the table's check constraints, so a bad value is refused with
// a readable message before the insert ever runs. Client-bundle-safe: the
// composer uses the limits for maxLength.

import { isSopRole, normalizeEmail, type SopRole } from '@/lib/sops/levels';

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
 * The audience a request body names. Roles must be SOP roles and always
 * include admin (they see everything regardless, and the row should say so);
 * emails are lowercased and deduped. Whether the emails are real roster
 * members is the route's check — it has the roster, this module doesn't.
 */
export function parseAudience(
  roles: unknown,
  emails: unknown
): { ok: true; audience: Audience } | { ok: false; error: string } {
  if (!Array.isArray(roles) || !roles.every(isSopRole)) {
    return { ok: false, error: 'audienceRoles must be staff, shift_lead, or admin' };
  }
  if (!Array.isArray(emails) || !emails.every((e) => typeof e === 'string')) {
    return { ok: false, error: 'audienceEmails must be a list of emails' };
  }
  const uniqueRoles = [...new Set(roles as SopRole[])];
  if (!uniqueRoles.includes('admin')) uniqueRoles.push('admin');
  const uniqueEmails = [...new Set((emails as string[]).map(normalizeEmail).filter(Boolean))];
  if (uniqueEmails.length > AUDIENCE_EMAILS_MAX) {
    return { ok: false, error: `audienceEmails may name at most ${AUDIENCE_EMAILS_MAX} people` };
  }
  return { ok: true, audience: { roles: uniqueRoles, emails: uniqueEmails } };
}

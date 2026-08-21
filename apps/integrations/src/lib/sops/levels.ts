// SOP access grants, shared by the API routes and the React islands (keep this
// module client-bundle-safe: no db/env imports).
//
// Each document names who may read it and who may save it, twice over: a set
// of roles and a set of individual staff emails. Access is the union of the
// two — your role is granted, or you are named personally. A person's role
// comes from their staff row (admin > shift lead > staff, see role.ts), but
// the roles here are a *set*, not a floor: 'staff' means people whose role is
// exactly staff, so granting shift leads no longer implicitly grants everyone
// below them.
//
// Two rules sit above the grants: admins always view and edit everything, and
// only admins change a document's grants. And one rule sits inside them: an
// edit grant implies a view grant, because a set-based edit grant with no
// matching view grant would otherwise be a silent no-op.

export const SOP_ROLES = ['staff', 'shift_lead', 'admin'] as const;
export type SopRole = (typeof SOP_ROLES)[number];

export const ROLE_LABELS: Record<SopRole, string> = {
  staff: 'Staff',
  shift_lead: 'Shift leads',
  admin: 'Admins',
};

export function isSopRole(value: unknown): value is SopRole {
  return typeof value === 'string' && (SOP_ROLES as readonly string[]).includes(value);
}

/** Who is asking: their resolved role, and the email their grants are named by. */
export interface SopViewer {
  role: SopRole;
  /** Session email, lowercased. Empty when the session has none. */
  email: string;
}

/** The grant columns on a `sops` row. */
export interface SopAccessFields {
  view_roles: SopRole[];
  edit_roles: SopRole[];
  view_emails: string[];
  edit_emails: string[];
  archived: boolean;
}

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

/** Whether one grant pair (roles + named emails) covers this viewer. */
function granted(viewer: SopViewer, roles: SopRole[], emails: string[]): boolean {
  if (roles.includes(viewer.role)) return true;
  return viewer.email.length > 0 && emails.includes(viewer.email);
}

/**
 * Whether `viewer` may read this SOP. Editors are readers: an admin who grants
 * someone edit access has plainly decided they may open the document, and
 * making them tick view as well would only produce grants that look right and
 * do nothing.
 */
export function canViewSop(viewer: SopViewer, sop: SopAccessFields): boolean {
  if (viewer.role === 'admin') return true;
  if (sop.archived) return false;
  return (
    granted(viewer, sop.view_roles, sop.view_emails) ||
    granted(viewer, sop.edit_roles, sop.edit_emails)
  );
}

/** Whether `viewer` may save new versions of this SOP. */
export function canEditSop(viewer: SopViewer, sop: SopAccessFields): boolean {
  if (viewer.role === 'admin') return true;
  // Archived documents are frozen for everyone but admins.
  if (sop.archived) return false;
  return granted(viewer, sop.edit_roles, sop.edit_emails);
}

/**
 * Whether these grants reach every role — the default for a new SOP, and the
 * case the library doesn't bother badging.
 */
export function isEveryoneGranted(roles: SopRole[]): boolean {
  return SOP_ROLES.every((role) => roles.includes(role));
}

/**
 * Grants as a short phrase for a badge or a summary line: "Shift leads",
 * "Admins + 2 people", "3 people". Empty grants read as "Nobody" rather than
 * as an empty string, since a document only admins can reach is a real (and
 * deliberate) state worth naming.
 */
/** What `describeGrants` says when every role is granted — the un-badged default. */
export const EVERYONE_LABEL = 'Everyone';

export function describeGrants(roles: SopRole[], emails: string[]): string {
  const named = SOP_ROLES.filter((role) => roles.includes(role)).map((role) => ROLE_LABELS[role]);
  const people =
    emails.length > 0 ? `${emails.length} ${emails.length === 1 ? 'person' : 'people'}` : '';

  if (named.length === 0) return people || 'Nobody';
  if (isEveryoneGranted(roles)) return people ? `${EVERYONE_LABEL} + ${people}` : EVERYONE_LABEL;
  return people ? `${named.join(' + ')} + ${people}` : named.join(' + ');
}

/**
 * Who can actually open the document: the view grants, widened by the edit
 * grants that imply them. The library badge reads from this — describing the
 * view grants alone would call a document "Nobody" while its editors read it
 * every shift.
 */
export function effectiveViewGrants(sop: {
  view_roles: SopRole[];
  edit_roles: SopRole[];
  view_emails: string[];
  edit_emails: string[];
}): { roles: SopRole[]; emails: string[] } {
  return {
    roles: SOP_ROLES.filter(
      (role) => sop.view_roles.includes(role) || sop.edit_roles.includes(role)
    ),
    emails: [...new Set([...sop.view_emails, ...sop.edit_emails])],
  };
}

/** Slug shape enforced by the sops table's check constraint. */
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Derive a slug from a title ("Set Up (A) — Fire + Water" → "set-up-a-fire-water"). */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}

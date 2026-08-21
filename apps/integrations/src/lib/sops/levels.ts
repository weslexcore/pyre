// SOP access tiers, shared by the API routes and the React islands (keep this
// module client-bundle-safe: no db/env imports). Each SOP carries a minimum
// role for viewing and a minimum role for editing; a person's role comes from
// their staff row (is_admin > is_shift_lead > staff). Admins always pass both
// checks, and only admins create/archive SOPs or change access settings.

export const SOP_ACCESS_LEVELS = ['staff', 'shift_lead', 'admin'] as const;
export type SopAccessLevel = (typeof SOP_ACCESS_LEVELS)[number];

/** A person's effective SOP role — the same scale the per-SOP minimums use. */
export type SopRole = SopAccessLevel;

const RANK: Record<SopAccessLevel, number> = { staff: 0, shift_lead: 1, admin: 2 };

export const ACCESS_LABELS: Record<SopAccessLevel, string> = {
  staff: 'All staff',
  shift_lead: 'Shift leads',
  admin: 'Admins',
};

export function isSopAccessLevel(value: unknown): value is SopAccessLevel {
  return typeof value === 'string' && (SOP_ACCESS_LEVELS as readonly string[]).includes(value);
}

export function meetsLevel(role: SopRole, minimum: SopAccessLevel): boolean {
  return RANK[role] >= RANK[minimum];
}

export interface SopAccessFields {
  view_access: SopAccessLevel;
  edit_access: SopAccessLevel;
  archived: boolean;
}

/** Whether `role` may read this SOP (archived SOPs are admin-only). */
export function canViewSop(role: SopRole, sop: SopAccessFields): boolean {
  if (role === 'admin') return true;
  return !sop.archived && meetsLevel(role, sop.view_access);
}

/** Whether `role` may save new versions of this SOP. */
export function canEditSop(role: SopRole, sop: SopAccessFields): boolean {
  if (role === 'admin') return true;
  // Editing implies reading; an SOP hidden from a role is never editable by
  // it, whatever edit_access says.
  return canViewSop(role, sop) && meetsLevel(role, sop.edit_access);
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

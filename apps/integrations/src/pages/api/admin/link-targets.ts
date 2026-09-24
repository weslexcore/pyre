// Targets for the internal-link autocomplete every markdown field in the
// dashboard offers (components/admin/LinkTextarea.tsx): the SOP documents the
// caller may read and the admin pages they may open. Anyone with dashboard
// access may call this; the lists are filtered the way the rest of the
// dashboard filters them — SOPs by the /admin/sops page grant plus
// per-document access (lib/sops/levels), pages by the same toolsForAccess +
// searchablePages pair the global search (cmd+K) is built from — so the
// picker never names a page or document the caller could not open.
//
//   GET → { targets: LinkTarget[] }

import type { APIRoute } from 'astro';
import { canViewPage, searchablePages, toolsForAccess } from '@/components/admin/adminTools';
import { requireStaff } from '@/lib/auth/admin';
import { getDb, type SopRow } from '@/lib/db';
import { canViewSop, normalizeEmail, type SopViewer } from '@/lib/sops/levels';
import type { LinkTarget } from '@/lib/sops/link-suggest';
import { type CategoryRank, sortSops } from '@/lib/sops/order';
import { getSopRole } from '@/lib/sops/role';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const SOPS_HREF = '/admin/sops';

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requireStaff(cookies);
  if (gate instanceof Response) return gate;

  const pages: LinkTarget[] = searchablePages(toolsForAccess(gate.access), gate.access.isAdmin)
    // The dashboard home is where everyone already starts; it is noise here.
    .filter((page) => page.href !== '/admin')
    .map((page) => ({
      href: page.href,
      title: page.title,
      detail: page.hint,
      kind: 'page',
    }));

  let sops: LinkTarget[] = [];
  if (canViewPage(gate.access, SOPS_HREF)) {
    const db = getDb();
    if (!db) return json({ error: 'Storage unavailable' }, 503);

    const [{ data, error }, { data: categories, error: categoriesError }] = await Promise.all([
      db
        .from('sops')
        .select(
          'slug, title, category, sort_order, archived, view_roles, view_emails, edit_roles, edit_emails'
        ),
      db.from('sop_categories').select('name, sort_order'),
    ]);
    if (error) return json({ error: error.message }, 500);
    if (categoriesError) return json({ error: categoriesError.message }, 500);

    const role = await getSopRole(gate.user.email ?? null, gate.access);
    const viewer: SopViewer = { role, email: normalizeEmail(gate.user.email) };
    // Admins pass canViewSop for archived documents too; a link to one would
    // point at something the library no longer lists, so they're left out.
    const visible = ((data ?? []) as SopRow[]).filter(
      (sop) => !sop.archived && canViewSop(viewer, sop)
    );
    sops = sortSops(visible, (categories ?? []) as CategoryRank[]).map((sop) => ({
      href: `${SOPS_HREF}/${sop.slug}`,
      title: sop.title,
      detail: sop.category,
      kind: 'sop',
    }));
  }

  return json({ targets: [...sops, ...pages] });
};

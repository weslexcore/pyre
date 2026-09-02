// Loads one SOP document the way the page needs it: the row (grant emails
// redacted for non-admins), the viewer's standing, the in-progress run with
// its checks, and the admin-only settings data — with the independent reads in
// flight together. Used by /api/admin/sops (?slug= / ?id=) and rendered
// straight into /admin/sops/[slug] so the island paints with everything on
// the first response instead of fetching the document and then the run.
// Server-only.

import type { getDb, SopRow } from '@/lib/db';
import { countTasks } from './checklist';
import {
  canEditSop,
  canViewSop,
  describeGrants,
  effectiveViewGrants,
  type SopRole,
  type SopViewer,
} from './levels';
import type { PeopleNames } from './names';
import { type CategoryRank, sectionsInOrder } from './order';
import { type GrantablePerson, getPeopleNames, listGrantablePeople } from './people';
import { loadRunState, runActors, type SopRunState } from './runs';

type Db = NonNullable<ReturnType<typeof getDb>>;

export interface SopDocumentPayload {
  sop: SopRow;
  /** Who can read this document, in words — computed here since non-admins
   * get the grant emails redacted and can't derive it themselves. */
  accessLabel: string;
  role: SopRole;
  canEdit: boolean;
  /** The session email, so the island can attribute optimistic checks. */
  viewerEmail: string;
  taskCount: number;
  /** The shared in-progress run, when someone has one open. */
  run: SopRunState | null;
  /** Every section name, in library order — admins only (they alone refile). */
  categories?: string[];
  /** Roster an admin can grant this document to; admins only. */
  staff?: GrantablePerson[];
  /** Roster names for everyone this payload names. */
  people: PeopleNames;
  /** Epoch ms the payload was assembled, for the island's staleness check. */
  loadedAt: number;
}

export type LoadDocumentResult =
  | { ok: true; doc: SopDocumentPayload }
  | { ok: false; status: 404 | 500; error: string };

export async function loadSop(
  db: Db,
  ref: { id?: string | null; slug?: string | null }
): Promise<{ sop: SopRow | null; error: string | null }> {
  let query = db.from('sops').select('*');
  if (ref.id) query = query.eq('id', ref.id);
  else if (ref.slug) query = query.eq('slug', ref.slug);
  else return { sop: null, error: null };

  const { data, error } = await query.maybeSingle();
  if (error) return { sop: null, error: error.message };
  return { sop: (data as SopRow) ?? null, error: null };
}

/**
 * Individually granted emails, for anyone who has no business reading the
 * roster. A staffer may open a document without being entitled to a list of
 * which teammates were named on it — the same reason getPeopleNames answers
 * only for emails a response already mentions.
 */
export function redactGrantEmails<T extends { view_emails: string[]; edit_emails: string[] }>(
  row: T,
  isAdmin: boolean
): T {
  if (isAdmin) return row;
  return { ...row, view_emails: [], edit_emails: [] };
}

export async function loadSopDocument(
  db: Db,
  viewer: SopViewer,
  ref: { id?: string | null; slug?: string | null }
): Promise<LoadDocumentResult> {
  const { sop, error } = await loadSop(db, ref);
  if (error) return { ok: false, status: 500, error };
  // 404 for both "doesn't exist" and "not allowed to know it exists".
  if (!sop || !canViewSop(viewer, sop)) return { ok: false, status: 404, error: 'SOP not found' };

  const isAdmin = viewer.role === 'admin';
  const taskCount = countTasks(sop.content_md);

  // The settings panel is admin-only and lets the document be refiled and
  // re-granted, so only admins need the sections and the roster to choose
  // from — the roster especially, since it's the whole staff address book.
  const [runResult, ranks, used, staff] = await Promise.all([
    taskCount > 0 ? loadRunState(db, sop) : Promise.resolve({ state: null, error: null }),
    isAdmin ? db.from('sop_categories').select('name, sort_order') : Promise.resolve(null),
    isAdmin ? db.from('sops').select('category') : Promise.resolve(null),
    isAdmin ? listGrantablePeople() : Promise.resolve(undefined),
  ]);
  if (runResult.error) return { ok: false, status: 500, error: runResult.error };
  if (ranks?.error) return { ok: false, status: 500, error: ranks.error.message };
  if (used?.error) return { ok: false, status: 500, error: used.error.message };

  const categories =
    ranks && used
      ? sectionsInOrder(
          (ranks.data ?? []) as CategoryRank[],
          (used.data ?? []) as { category: string }[]
        )
      : undefined;

  const run = runResult.state;
  const grants = effectiveViewGrants(sop);
  const people = await getPeopleNames([
    sop.updated_by ?? '',
    viewer.email,
    ...(run ? runActors(run.run, run.checks) : []),
  ]);

  return {
    ok: true,
    doc: {
      sop: redactGrantEmails(sop, isAdmin),
      accessLabel: describeGrants(grants.roles, grants.emails),
      role: viewer.role,
      canEdit: canEditSop(viewer, sop),
      viewerEmail: viewer.email,
      taskCount,
      run,
      categories,
      staff,
      people,
      loadedAt: Date.now(),
    },
  };
}

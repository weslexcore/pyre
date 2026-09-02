// SOP library reads for the knowledge assistant: the table of contents and
// whole documents or single sections, always filtered by the asker's grants
// (the same rule as the dashboard's canViewSop — admins read everything,
// everyone else needs their role or their email on a non-archived
// document's view or edit grants).

import { getDb } from '../db';
import type { KnowledgeScope } from '../role';
import { outline, splitSections } from './markdown';
import { sopUrl } from './urls';

export interface SopRow {
  id: string;
  slug: string;
  title: string;
  category: string;
  content_md: string;
  archived: boolean;
  view_roles: string[];
  edit_roles: string[];
  view_emails: string[];
  edit_emails: string[];
  sort_order: number;
  current_version: number;
  updated_at: string;
}

const SOP_COLUMNS =
  'id, slug, title, category, content_md, archived, view_roles, edit_roles, view_emails, edit_emails, sort_order, current_version, updated_at';

export function canViewSop(scope: KnowledgeScope, sop: SopRow): boolean {
  if (scope.role === 'admin') return true;
  if (sop.archived) return false;
  if (sop.view_roles.includes(scope.role) || sop.edit_roles.includes(scope.role)) return true;
  return (
    scope.email.length > 0 &&
    (sop.view_emails.includes(scope.email) || sop.edit_emails.includes(scope.email))
  );
}

/** Every SOP the asker may read, in library order. */
export async function listVisibleSops(scope: KnowledgeScope): Promise<SopRow[]> {
  const { data, error } = await getDb()
    .from('sops')
    .select(SOP_COLUMNS)
    .order('category')
    .order('sort_order')
    .order('title');
  if (error) throw new Error(error.message);
  return ((data ?? []) as SopRow[]).filter((sop) => canViewSop(scope, sop));
}

/** A readable SOP by slug, or null when missing or not permitted (indistinguishable on purpose). */
export async function loadVisibleSop(scope: KnowledgeScope, slug: string): Promise<SopRow | null> {
  const { data, error } = await getDb().from('sops').select(SOP_COLUMNS).eq('slug', slug).maybeSingle();
  if (error) throw new Error(error.message);
  const sop = data as SopRow | null;
  return sop && canViewSop(scope, sop) ? sop : null;
}

/** The library as a table of contents the model can browse. */
export async function sopTableOfContents(scope: KnowledgeScope) {
  const sops = await listVisibleSops(scope);
  return {
    count: sops.length,
    documents: sops.map((sop) => ({
      slug: sop.slug,
      title: sop.title,
      category: sop.category,
      archived: sop.archived,
      updatedAt: sop.updated_at.slice(0, 10),
      url: sopUrl(sop.slug),
      sections: outline(sop.content_md)
        .filter((h) => h.level <= 3)
        .map((h) => ({ heading: h.heading, anchor: h.anchor })),
    })),
  };
}

/** A document, or one of its sections (by anchor or heading text). */
export async function readSop(scope: KnowledgeScope, slug: string, section?: string | null) {
  const sop = await loadVisibleSop(scope, slug);
  if (!sop) {
    return {
      found: false as const,
      error: `No SOP with slug "${slug}" is available to this staff member. Use list_sops to see the library.`,
    };
  }

  const sections = splitSections(sop.content_md);
  const toc = outline(sop.content_md);
  const base = {
    found: true as const,
    slug: sop.slug,
    title: sop.title,
    category: sop.category,
    archived: sop.archived,
    version: sop.current_version,
    updatedAt: sop.updated_at.slice(0, 10),
    url: sopUrl(sop.slug),
    sections: toc,
  };

  if (!section) return { ...base, markdown: sop.content_md };

  const wanted = section.trim().replace(/^#/, '').toLowerCase();
  const index = sections.findIndex(
    (s) => s.anchor === wanted || s.heading.trim().toLowerCase() === wanted
  );
  if (index === -1) {
    return {
      ...base,
      section: null,
      error: `No section "${section}" in this document; see sections for the available anchors.`,
      markdown: sop.content_md,
    };
  }

  // The section plus its subsections (everything until the next heading of
  // the same or a higher level).
  const start = sections[index];
  let markdown = start.markdown;
  for (let i = index + 1; i < sections.length && sections[i].level > start.level; i++) {
    markdown += sections[i].markdown;
  }
  return {
    ...base,
    section: { heading: start.heading, anchor: start.anchor },
    url: sopUrl(sop.slug, start.anchor),
    markdown,
  };
}

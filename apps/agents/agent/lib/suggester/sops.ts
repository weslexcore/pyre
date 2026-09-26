// SOP reads for proposing an edit: the whole document, raw, with the version
// the edit will be made against. Suggester sessions read with an admin's view
// of the library — what they propose goes only to admins.

import { listVisibleSops, loadVisibleSop, sopTableOfContents } from '../knowledge/sops';
import { DEFAULT_KNOWLEDGE_SCOPE, type KnowledgeScope } from '../role';

const ADMIN_SCOPE: KnowledgeScope = { ...DEFAULT_KNOWLEDGE_SCOPE, role: 'admin' };

export function suggesterSopContents() {
  return sopTableOfContents(ADMIN_SCOPE);
}

export async function readSopForEdit(slug: string) {
  const sop = await loadVisibleSop(ADMIN_SCOPE, slug);
  if (!sop || sop.archived) {
    const known = (await listVisibleSops(ADMIN_SCOPE)).filter((s) => !s.archived).length;
    return {
      found: false as const,
      error: `No active SOP "${slug}" (${known} in the library). Use list_sops for the slugs.`,
    };
  }
  return {
    found: true as const,
    slug: sop.slug,
    title: sop.title,
    version: sop.current_version,
    markdown: sop.content_md,
  };
}

// Ranked search across the knowledge base via the knowledge_search SQL
// function (apps/supabase/migrations/20260903100000_knowledge_search.sql),
// which applies the asker's dashboard access itself from the scope we pass.
// SOP hits are refined here: the matching section is located so the link
// carries a #anchor, and snippets are stripped of markdown.

import { getDb } from '../db';
import type { KnowledgeScope } from '../role';
import { bestSection, cleanSnippet, splitSections } from './markdown';
import { canViewSop, type SopRow } from './sops';
import { incidentUrl, SHIFT_NOTES_URL_PATH, siteUrl, sopUrl, WATER_LOG_URL_PATH } from './urls';

export type KnowledgeSource = 'sop' | 'shift_note' | 'incident' | 'water_test';

export const KNOWLEDGE_SOURCES: KnowledgeSource[] = ['sop', 'shift_note', 'incident', 'water_test'];

interface SearchRow {
  source: KnowledgeSource;
  ref: string;
  title: string;
  category: string;
  snippet: string | null;
  rank: number;
  happened_on: string | null;
}

export interface KnowledgeHit {
  source: KnowledgeSource;
  /** SOP slug, incident reference, or row id. */
  ref: string;
  title: string;
  category: string;
  /** The section of an SOP the query lands in, when one stands out. */
  section?: { heading: string; anchor: string | null };
  url: string;
  snippet: string;
  /** Last edit (SOPs) or the date the entry describes (logs). */
  date: string | null;
  rank: number;
}

export interface SearchInput {
  query: string;
  sources?: KnowledgeSource[];
  limit?: number;
}

async function runSearch(
  scope: KnowledgeScope,
  query: string,
  sources: KnowledgeSource[],
  limit: number
): Promise<SearchRow[]> {
  const { data, error } = await getDb().rpc('knowledge_search', {
    p_query: query,
    p_role: scope.role,
    p_email: scope.email,
    p_shift_notes: sources.includes('shift_note') ? scope.shiftNotes : null,
    p_incidents: sources.includes('incident') ? scope.incidents : null,
    p_water: sources.includes('water_test') && scope.water,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as SearchRow[];
  return sources.includes('sop') ? rows : rows.filter((r) => r.source !== 'sop');
}

/**
 * Search, first requiring every term (websearch syntax), then — when that
 * finds nothing — any term, so a long question still surfaces the document
 * about its subject.
 */
export async function searchKnowledge(scope: KnowledgeScope, input: SearchInput) {
  const query = input.query.trim().slice(0, 200);
  const sources = input.sources?.length ? input.sources : KNOWLEDGE_SOURCES;
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 20);

  let mode: 'all-terms' | 'any-term' = 'all-terms';
  let rows = query ? await runSearch(scope, query, sources, limit) : [];
  if (rows.length === 0 && query) {
    const words = query.split(/\s+/).filter((w) => w.length >= 3 && !/["()]/.test(w));
    if (words.length > 1) {
      mode = 'any-term';
      rows = await runSearch(scope, words.join(' or '), sources, limit);
    }
  }

  // Locate the matching section of each SOP hit for an anchored link.
  const sopSlugs = rows.filter((r) => r.source === 'sop').map((r) => r.ref);
  const sopBySlug = new Map<string, SopRow>();
  if (sopSlugs.length > 0) {
    const { data, error } = await getDb()
      .from('sops')
      .select(
        'id, slug, title, category, content_md, archived, view_roles, edit_roles, view_emails, edit_emails, sort_order, current_version, updated_at'
      )
      .in('slug', sopSlugs);
    if (error) throw new Error(error.message);
    for (const sop of (data ?? []) as SopRow[]) {
      if (canViewSop(scope, sop)) sopBySlug.set(sop.slug, sop);
    }
  }

  const results: KnowledgeHit[] = [];
  for (const row of rows) {
    const snippet = cleanSnippet(row.snippet ?? '');
    switch (row.source) {
      case 'sop': {
        const sop = sopBySlug.get(row.ref);
        if (!sop) continue;
        const section = bestSection(splitSections(sop.content_md), query);
        results.push({
          source: 'sop',
          ref: row.ref,
          title: row.title,
          category: row.category,
          ...(section ? { section: { heading: section.heading, anchor: section.anchor } } : {}),
          url: sopUrl(row.ref, section?.anchor),
          snippet,
          date: row.happened_on,
          rank: row.rank,
        });
        break;
      }
      case 'shift_note':
        results.push({
          source: 'shift_note',
          ref: row.ref,
          title: row.title,
          category: row.category,
          url: siteUrl(SHIFT_NOTES_URL_PATH),
          snippet,
          date: row.happened_on,
          rank: row.rank,
        });
        break;
      case 'incident':
        results.push({
          source: 'incident',
          ref: row.ref,
          title: row.title,
          category: row.category,
          url: siteUrl('/admin/incidents'),
          snippet,
          date: row.happened_on,
          rank: row.rank,
        });
        break;
      case 'water_test':
        results.push({
          source: 'water_test',
          ref: row.ref,
          title: row.title,
          category: row.category,
          url: siteUrl(WATER_LOG_URL_PATH),
          snippet,
          date: row.happened_on,
          rank: row.rank,
        });
        break;
    }
  }

  return {
    query,
    mode,
    searched: {
      sops: sources.includes('sop'),
      shiftNotes: sources.includes('shift_note') ? scope.shiftNotes : null,
      incidents: sources.includes('incident') ? scope.incidents : null,
      waterLog: sources.includes('water_test') && scope.water,
    },
    count: results.length,
    results,
    hint:
      results.length === 0
        ? 'No matches. Try different wording or fewer terms, or call list_sops to browse the library by title and section.'
        : 'Call read_sop on the most relevant document (pass the section anchor to read just that part) before answering.',
  };
}

export { incidentUrl };

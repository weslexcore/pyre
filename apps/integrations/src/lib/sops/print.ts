// The printable view of one or more SOPs (/admin/sops/print?slugs=a,b,c).
// The library's select mode and the document page's Print button both build
// the URL here; the page parses it back and stamps each document's footer
// with the version it printed and who last changed it, so a sheet taped to
// the wall can be checked against the live library.

import { etStampWithYear } from '@/lib/client/format';
import { type PeopleNames, personName } from './names';

export const PRINT_PATH = '/admin/sops/print';

/** More than the library will ever hold; bounds the query a URL can ask for. */
export const MAX_PRINT_SOPS = 200;

/** The print URL for these documents, in the order they should print. */
export function sopPrintHref(slugs: string[]): string {
  return `${PRINT_PATH}?slugs=${slugs.map(encodeURIComponent).join(',')}`;
}

/**
 * The slugs a print URL asks for: comma-separated, trimmed, deduplicated
 * (first position wins) and capped. Anything that can't be a slug is dropped
 * rather than queried.
 */
export function parsePrintSlugs(param: string | null): string[] {
  const seen = new Set<string>();
  for (const raw of (param ?? '').split(',')) {
    const slug = raw.trim().toLowerCase();
    if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) seen.add(slug);
    if (seen.size >= MAX_PRINT_SOPS) break;
  }
  return [...seen];
}

/** The printed footer: version, when it last changed (studio time), and by whom. */
export function printFooter(
  sop: { current_version: number; updated_at: string; updated_by: string | null },
  people?: PeopleNames
): string {
  const by = sop.updated_by
    ? sop.updated_by === 'seed'
      ? 'initial import'
      : personName(sop.updated_by, people)
    : null;
  return `Version ${sop.current_version} · Last changed ${etStampWithYear(sop.updated_at)}${
    by ? ` by ${by}` : ''
  }`;
}

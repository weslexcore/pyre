// Applying a suggested SOP edit. The agent proposes an edit as exact
// find-and-replace hunks rather than a rewritten document — a long procedure
// comes back byte-for-byte except where it should change, and the hunks can
// be replayed on a newer version if someone saves the SOP before the
// suggestion is approved. A whole new section is a hunk too: placed before an
// existing heading (a replace on that heading line) or appended at the end.
// Pure and client-bundle-safe.

import { isAppendHunk, type SopHunk } from '@/lib/suggestions/types';

export type HunkResult = { ok: true; content: string } | { ok: false; error: string };

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    count++;
    if (count > 1) break;
  }
  return count;
}

/**
 * Apply each hunk in order. Each `find` must appear exactly once in the
 * document as it stands after the hunks before it — an edit that matches
 * nothing (the text was paraphrased) or several places (ambiguous) is refused
 * with the hunk named, so the agent can copy the text exactly and try again.
 */
export function applyHunks(base: string, hunks: readonly SopHunk[]): HunkResult {
  let content = base;
  for (const [i, hunk] of hunks.entries()) {
    if (isAppendHunk(hunk)) {
      content = appendSection(content, hunk.append);
      continue;
    }
    const found = occurrences(content, hunk.find);
    if (found === 0) {
      return {
        ok: false,
        error: `edits[${i}].find does not appear in the SOP; copy the text exactly from read_sop_for_edit`,
      };
    }
    if (found > 1) {
      return {
        ok: false,
        error: `edits[${i}].find appears more than once in the SOP; include more surrounding text so it matches one place`,
      };
    }
    content = content.replace(hunk.find, () => hunk.replace);
  }
  return { ok: true, content };
}

/**
 * The edit re-made against a newer version of the SOP, or null when it can't
 * be done automatically: the admin has changed the proposed text by hand
 * (their edit is not a replay of the hunks, so replaying would lose it), or a
 * hunk no longer matches exactly once in the new version.
 */
export function rebaseSopEdit(
  payload: { contentMd: string; edits: readonly SopHunk[] },
  previousBase: string,
  currentContent: string
): string | null {
  if (payload.edits.length === 0) return null;
  const original = applyHunks(previousBase, payload.edits);
  if (!original.ok || original.content !== payload.contentMd) return null;
  const rebased = applyHunks(currentContent, payload.edits);
  return rebased.ok ? rebased.content : null;
}

/** `text` added after `content` as its own block: one blank line between, one newline after. */
export function appendSection(content: string, text: string): string {
  const body = text.trim();
  const head = content.trimEnd();
  return head ? `${head}\n\n${body}\n` : `${body}\n`;
}

/** A markdown heading line: one to six #s, a space, and its text. */
const HEADING_RE = /^#{1,6}\s+\S/;

/**
 * A new section as the agent describes it — its markdown (starting with its
 * own heading) and, optionally, the existing heading it goes before — turned
 * into the hunk that adds it. `before` is matched as a whole heading line of
 * `content`, so "## Closing" never lands inside a paragraph that mentions
 * closing; with no `before` the section goes at the end.
 */
export function sectionHunk(
  content: string,
  input: { section: string; before?: string | null }
): { ok: true; hunk: SopHunk } | { ok: false; error: string } {
  const section = input.section.trim();
  if (!section) return { ok: false, error: 'section must not be empty' };
  if (!HEADING_RE.test(section)) {
    return {
      ok: false,
      error: 'section must start with its own markdown heading (e.g. "## Late arrivals")',
    };
  }
  const before = input.before?.trim();
  if (!before) return { ok: true, hunk: { append: section } };

  const lines = content.split('\n');
  const matches = lines.filter((line) => line.trim() === before);
  if (!HEADING_RE.test(before) || matches.length === 0) {
    return {
      ok: false,
      error: `before must be a heading line of the SOP exactly as read_sop shows it (e.g. "## Closing"); "${before}" is not one`,
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      error: `the heading "${before}" appears more than once; use a find-and-replace edit instead`,
    };
  }
  // The heading with the line breaks around it, so the find matches that
  // whole line and never the same words inside a longer heading.
  const at = lines.findIndex((line) => line.trim() === before);
  const line = lines[at] as string;
  const lead = at > 0 ? '\n' : '';
  const trail = at < lines.length - 1 ? '\n' : '';
  return {
    ok: true,
    hunk: { find: `${lead}${line}${trail}`, replace: `${lead}${section}\n\n${line}${trail}` },
  };
}

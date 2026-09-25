// Applying a suggested SOP edit. The agent proposes an edit as exact
// find-and-replace hunks rather than a rewritten document — a long procedure
// comes back byte-for-byte except where it should change, and the hunks can
// be replayed on a newer version if someone saves the SOP before the
// suggestion is approved. Pure and client-bundle-safe.

import type { SopHunk } from '@/lib/suggestions/types';

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

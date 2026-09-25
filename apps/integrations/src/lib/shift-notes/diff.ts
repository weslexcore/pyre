// A word-level diff of a shift note's text, for showing what an edit changed
// in the note's history: the words taken out and the words put in, with the
// rest as context. Notes are short, so a plain longest-common-subsequence
// over words is plenty; past a size cap (a rewrite of a very long note) it
// gives up on precision and shows the whole old text out, the new text in.
//
// Client-bundle-safe (no imports): the island renders it.

export interface DiffSegment {
  op: 'same' | 'add' | 'del';
  text: string;
}

/** LCS table cells allowed before falling back to a whole replace. */
const MAX_CELLS = 1_000_000;

/** Words and the whitespace between them, so joining the pieces gives the text back. */
function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((t) => t !== '');
}

function push(out: DiffSegment[], op: DiffSegment['op'], text: string): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.op === op) last.text += text;
  else out.push({ op, text });
}

/** What changed from `before` to `after`, as runs of kept, removed, and added text. */
export function diffWords(before: string, after: string): DiffSegment[] {
  const a = tokenize(before);
  const b = tokenize(after);

  // Most edits touch one spot: peel off what the two share at each end.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const out: DiffSegment[] = [];
  push(out, 'same', a.slice(0, start).join(''));

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;

  if ((n + 1) * (m + 1) > MAX_CELLS) {
    push(out, 'del', midA.join(''));
    push(out, 'add', midB.join(''));
  } else {
    // lcs[i][j]: common length of midA[i..] and midB[j..], flattened.
    const width = m + 1;
    const lcs = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * width + j] =
          midA[i] === midB[j]
            ? lcs[(i + 1) * width + j + 1] + 1
            : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        push(out, 'same', midA[i++]);
        j++;
      } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
        push(out, 'del', midA[i++]);
      } else {
        push(out, 'add', midB[j++]);
      }
    }
    while (i < n) push(out, 'del', midA[i++]);
    while (j < m) push(out, 'add', midB[j++]);
  }

  push(out, 'same', a.slice(endA).join(''));
  return out;
}

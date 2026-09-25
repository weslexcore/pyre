// A line diff between two SOP snapshots: the version history panel shows each
// version against the one before it, and a suggested SOP edit shows the
// proposal against the current document. With `context`, long runs of
// unchanged lines fold down to that many lines either side of a change, so a
// two-line edit in a long procedure reads as two lines.

import { useMemo } from 'react';
import { type DiffLine, diffLines } from '@/lib/sops/diff';

type Row = DiffLine | { kind: 'fold'; count: number };

function foldUnchanged(lines: DiffLine[], context: number): Row[] {
  const keep = lines.map((line) => line.kind !== 'same');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].kind === 'same') continue;
    for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) {
      keep[j] = true;
    }
  }
  const rows: Row[] = [];
  let folded = 0;
  lines.forEach((line, i) => {
    if (keep[i]) {
      if (folded > 0) rows.push({ kind: 'fold', count: folded });
      folded = 0;
      rows.push(line);
    } else {
      folded++;
    }
  });
  if (folded > 0) rows.push({ kind: 'fold', count: folded });
  return rows;
}

export function SopDiff({
  before,
  after,
  context,
  className = 'max-h-96',
}: {
  before: string;
  after: string;
  /** Unchanged lines to keep around each change; omit to show everything. */
  context?: number;
  className?: string;
}) {
  const rows = useMemo(() => {
    const lines = diffLines(before, after);
    return context === undefined ? (lines as Row[]) : foldUnchanged(lines, context);
  }, [before, after, context]);
  return (
    <pre
      className={`mt-2 overflow-auto rounded border border-white/10 bg-black/30 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap ${className}`}
    >
      {rows.map((line, i) =>
        line.kind === 'fold' ? (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are positional
            key={i}
            className="text-white/30 italic"
          >
            {`  … ${line.count} unchanged line${line.count === 1 ? '' : 's'}`}
          </div>
        ) : (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are positional
            key={i}
            className={
              line.kind === 'added'
                ? 'bg-[var(--pyre-sage)]/15 text-[var(--pyre-sage)]'
                : line.kind === 'removed'
                  ? 'bg-[var(--pyre-red)]/15 text-[var(--pyre-red)] line-through decoration-[var(--pyre-red)]/40'
                  : 'text-white/50'
            }
          >
            {line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '− ' : '  '}
            {line.text || ' '}
          </div>
        )
      )}
    </pre>
  );
}

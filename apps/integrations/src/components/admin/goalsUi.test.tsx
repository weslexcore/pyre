import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BoardColumnKind } from '@/lib/db';
import { ColumnDot } from './goalsUi';

describe('ColumnDot', () => {
  it.each([
    ['todo', 'Backlog', 'open', 'bg-white/30'],
    ['in_progress', 'In progress', 'open', 'bg-[var(--pyre-gold)]'],
    ['todo', 'Active', 'open', 'bg-[var(--pyre-gold)]'],
    ['in_progress', 'To do', 'open', 'bg-white/30'],
    ['in_progress', 'Underway', 'open', 'bg-[var(--pyre-gold)]'],
    ['custom', 'Custom queue', 'open', 'bg-white/30'],
    ['active', 'Active', 'done', 'bg-[var(--pyre-sage)]'],
    ['active', 'Active', 'dropped', 'bg-white/15'],
  ])('renders %s / %s / %s with its workflow color', (key, label, kind, color) => {
    const html = renderToStaticMarkup(
      <ColumnDot column={{ key, label, kind: kind as BoardColumnKind }} />
    );
    expect(html).toContain(color);
    expect(html).toContain(`aria-label="${label}"`);
    expect(html).toContain(`title="${label}"`);
  });
});

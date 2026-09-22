import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BoardColumnKind } from '@/lib/db';
import { ColumnDot, DueChip } from './goalsUi';

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

describe('DueChip', () => {
  // A fixed "today" so the ladder is read against a date, not the clock.
  const today = '2026-09-22';

  it.each([
    ['ahead of today', '2026-09-29', false, 'var(--pyre-sage)'],
    ['on today', today, false, 'var(--pyre-gold)'],
    ['behind today', '2026-09-10', false, 'var(--pyre-red)'],
    // A task that shipped late is not still late.
    ['behind today but finished', '2026-09-10', true, 'text-white/35'],
  ])('colors a date %s', (_label, dueDate, finished, color) => {
    const html = renderToStaticMarkup(
      <DueChip dueDate={dueDate as string} today={today} finished={finished as boolean} />
    );
    expect(html).toContain(color);
  });

  it('leaves no brand color on a finished card', () => {
    const html = renderToStaticMarkup(<DueChip dueDate="2026-09-29" today={today} finished />);
    expect(html).not.toContain('var(--pyre-sage)');
  });
});

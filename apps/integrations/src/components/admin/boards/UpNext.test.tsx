import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { UpNextCard } from '@/lib/boards/store';
import { UpNext } from './UpNext';

const card: UpNextCard = {
  id: 'c1',
  title: 'Deep-clean the stoves',
  due_date: '2026-10-09',
  repeat_every: 1,
  repeat_unit: 'month',
  board_slug: 'goals',
  board_name: 'Tasks',
};

describe('UpNext', () => {
  it('links each card to its drawer on its own board', () => {
    const html = renderToStaticMarkup(<UpNext cards={[card]} today="2026-10-02" />);
    expect(html).toContain('href="/admin/boards/goals#card-c1"');
    expect(html).toContain('Deep-clean the stoves');
    expect(html).toContain('Tasks');
    expect(html).toContain('Repeats monthly');
  });

  it('counts the cards past the limit at the end of the strip', () => {
    const html = renderToStaticMarkup(<UpNext cards={[card]} total={8} today="2026-10-02" />);
    expect(html).toContain('+7 more not shown');
    expect(renderToStaticMarkup(<UpNext cards={[card]} today="2026-10-02" />)).not.toContain(
      'more not shown'
    );
  });

  it('draws the end-of-week rule before the first card due after Sunday', () => {
    const soon = { ...card, due_date: '2026-10-04' };
    const later = { ...card, id: 'c2', due_date: '2026-10-05' };
    const html = renderToStaticMarkup(<UpNext cards={[soon, later]} today="2026-10-02" />);
    expect(html.indexOf('After this week')).toBeGreaterThan(html.indexOf('#card-c1'));
    expect(html.indexOf('After this week')).toBeLessThan(html.indexOf('#card-c2'));
  });

  it('says so when nothing dated is on the viewer', () => {
    expect(renderToStaticMarkup(<UpNext cards={[]} today="2026-10-02" />)).toContain(
      'Nothing with a due date is on you.'
    );
  });
});

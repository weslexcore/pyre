import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BoardEventRow } from '@/lib/db';
import { ActivityFeed, EventEntries } from './ActivityFeed';

const events = [
  {
    id: '1',
    actor: 'alex@example.com',
    action: 'updated',
    note: 'Change explanation',
    detail: { title: { from: 'Old', to: 'New' } },
    created_at: '2026-09-21T12:00:00Z',
  },
  {
    id: '2',
    actor: 'alex@example.com',
    action: 'comment',
    note: 'First discussion',
    detail: {},
    created_at: '2026-09-21T13:00:00Z',
  },
  {
    id: '3',
    actor: 'alex@example.com',
    action: 'comment',
    note: 'Second discussion',
    detail: {},
    created_at: '2026-09-21T14:00:00Z',
  },
] as BoardEventRow[];

function render(mode: 'comments' | 'activity' | 'all', entries = events) {
  return renderToStaticMarkup(
    <EventEntries
      events={entries}
      mode={mode}
      loading={false}
      subjectTitle="Task"
      columns={[]}
      people={{}}
    />
  );
}

describe('card discussion and activity', () => {
  it('shows only discussion in comments, newest first', () => {
    const html = render('comments');
    expect(html).toContain('First discussion');
    expect(html.indexOf('Second discussion')).toBeLessThan(html.indexOf('First discussion'));
    expect(html).not.toContain('Change explanation');
    expect(html).not.toContain('changed the title');
  });

  it('keeps changes and their explanatory notes in activity', () => {
    const html = render('activity');
    expect(html).toContain('changed the title');
    expect(html).toContain('Change explanation');
    expect(html).not.toContain('discussion');
  });

  it('gives each section its own empty state', () => {
    expect(render('comments', [events[0]])).toContain('No comments yet.');
    expect(render('activity', [events[1]])).toContain('No changes yet.');
  });

  it('separates cards into comments and a collapsed activity panel', () => {
    const html = renderToStaticMarkup(
      <ActivityFeed cardId="card" subjectTitle="Task" columns={[]} people={{}} />
    );
    expect(html).toContain('Comments');
    expect(html).toContain('<details');
    expect(html).toContain('Activity · 0');
    expect(html).not.toContain('<details open');
    expect(html.match(/<form/g)).toHaveLength(1);
  });

  it('preserves the combined view for goals', () => {
    const html = render('all');
    expect(html).toContain('First discussion');
    expect(html).toContain('Change explanation');
    const goal = renderToStaticMarkup(
      <ActivityFeed goalId="goal" subjectTitle="Goal" columns={[]} people={{}} />
    );
    expect(goal).not.toContain('<details');
  });
});

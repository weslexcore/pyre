import { describe, expect, it } from 'vitest';
import { describeEvent, timeAgo } from './history';

const columns = new Map([
  ['col-todo', { label: 'To do' }],
  ['col-doing', { label: 'In progress' }],
]);
const people = { 'maya@pyresauna.com': 'Maya Ortiz' };

const describe_ = (
  action: string,
  detail: Record<string, unknown> = {},
  note: string | null = null
) => describeEvent({ action: action as never, detail, note }, 'Train the staff', columns, people);

describe('describeEvent', () => {
  it('describes a creation by name', () => {
    expect(describe_('created')).toBe('added “Train the staff”');
  });

  it('turns column ids into labels', () => {
    expect(describe_('moved', { column_id: { from: 'col-todo', to: 'col-doing' } })).toBe(
      'moved it from To do to In progress'
    );
    expect(describe_('moved', { column_id: { from: null, to: 'col-doing' } })).toBe(
      'moved it to In progress'
    );
    expect(describe_('moved', {})).toBe('moved it');
  });

  it('turns an owner email into a name, and says when one was removed', () => {
    expect(describe_('assigned', { owner_email: { from: null, to: 'maya@pyresauna.com' } })).toBe(
      'assigned it to Maya Ortiz'
    );
    expect(describe_('assigned', { owner_email: { from: 'maya@pyresauna.com', to: null } })).toBe(
      'took the owner off it'
    );
  });

  it('describes a date change on either subject', () => {
    expect(describe_('due_changed', { due_date: { from: null, to: '2026-10-01' } })).toBe(
      'set the date to 2026-10-01'
    );
    expect(describe_('due_changed', { target_date: { from: '2026-10-01', to: null } })).toBe(
      'cleared the date'
    );
  });

  it('labels a status change', () => {
    expect(describe_('status_changed', { status: { from: 'planned', to: 'active' } })).toBe(
      'moved it from Planned to Active'
    );
  });

  it('reads a KPI measurement as a before and after', () => {
    expect(
      describe_('kpi_updated', { kpi_id: 'k1', name: 'Consecutive weeks', from: 2, to: 3 })
    ).toBe('measured Consecutive weeks: 2 → 3');
    expect(describe_('kpi_updated', { name: 'Consecutive weeks', from: null, to: 1 })).toBe(
      'measured Consecutive weeks: — → 1'
    );
  });

  it('carries the completion preview into the line', () => {
    expect(describe_('completed', { kpisMet: 1, kpisTotal: 2, openCards: 3 })).toBe(
      'marked it completed — 1 of 2 KPIs met, 3 tasks still open'
    );
    expect(describe_('completed', { kpisMet: 2, kpisTotal: 2, openCards: 1 })).toBe(
      'marked it completed — 2 of 2 KPIs met, 1 task still open'
    );
    expect(describe_('completed', { kpisMet: 0, kpisTotal: 0, openCards: 0 })).toBe(
      'marked it completed'
    );
  });

  it('gives a comment back as what was said', () => {
    expect(describe_('comment', {}, 'Waiting on the insurer.')).toBe('Waiting on the insurer.');
  });

  it('lists what an update touched, in words', () => {
    expect(describe_('updated', { title: { from: 'a', to: 'b' } })).toBe('changed the title');
    expect(
      describe_('updated', { title: { from: 'a', to: 'b' }, notes_md: { from: '', to: 'x' } })
    ).toBe('changed the title and the notes');
    expect(
      describe_('updated', {
        title: { from: 'a', to: 'b' },
        notes_md: { from: '', to: 'x' },
        area: { from: null, to: 'Tech' },
      })
    ).toBe('changed the title, the notes and the area');
  });
});

describe('timeAgo', () => {
  const now = '2026-09-21T12:00:00Z';
  it('reads as a person would say it', () => {
    expect(timeAgo('2026-09-21T11:59:40Z', now)).toBe('just now');
    expect(timeAgo('2026-09-21T11:30:00Z', now)).toBe('30 min ago');
    expect(timeAgo('2026-09-21T06:00:00Z', now)).toBe('6 hr ago');
    expect(timeAgo('2026-09-20T06:00:00Z', now)).toBe('yesterday');
    expect(timeAgo('2026-09-10T12:00:00Z', now)).toBe('11 days ago');
    expect(timeAgo('2026-08-10T12:00:00Z', now)).toBe('a month ago');
  });
});

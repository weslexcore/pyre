import { describe, expect, it } from 'vitest';
import type { BoardFieldValue } from '@/lib/db';
import { diffFields, eventsForCardPatch, eventsForGoalPatch } from './diff';

const card = {
  column_id: 'todo',
  owner_email: null,
  due_date: null,
  title: 'Write the rental SOP',
  notes_md: '',
  waiting_on: null,
  area: null,
  goal_id: null,
  properties: {} as Record<string, BoardFieldValue>,
};

describe('diffFields', () => {
  it('reports only the keys that actually changed', () => {
    expect(diffFields(card, { title: 'Write the rental SOP' }, ['title'])).toEqual({});
    expect(diffFields(card, { title: 'New' }, ['title'])).toEqual({
      title: { from: 'Write the rental SOP', to: 'New' },
    });
  });

  it('ignores keys the patch never mentioned', () => {
    expect(diffFields(card, { title: 'New' }, ['owner_email'])).toEqual({});
  });

  it('treats null and undefined as the same absence', () => {
    expect(diffFields(card, { owner_email: undefined }, ['owner_email'])).toEqual({});
  });

  it('compares arrays and objects by value', () => {
    const before = { properties: { tags: ['a', 'b'], n: 1 } };
    expect(diffFields(before, { properties: { tags: ['a', 'b'], n: 1 } }, ['properties'])).toEqual(
      {}
    );
    expect(
      diffFields(before, { properties: { tags: ['a'], n: 1 } }, ['properties']).properties
    ).toBeTruthy();
  });
});

describe('eventsForCardPatch', () => {
  it('writes nothing when nothing changed', () => {
    expect(eventsForCardPatch(card, { title: 'Write the rental SOP' })).toEqual([]);
    expect(eventsForCardPatch(card, {})).toEqual([]);
  });

  it('gives a move, an assignment, and a date their own lines', () => {
    const events = eventsForCardPatch(card, {
      column_id: 'doing',
      owner_email: 'maya@pyresauna.com',
      due_date: '2026-10-01',
    });
    expect(events.map((e) => e.action)).toEqual(['moved', 'assigned', 'due_changed']);
    expect(events[0].detail).toEqual({ column_id: { from: 'todo', to: 'doing' } });
  });

  it('collapses everything else into one updated', () => {
    const events = eventsForCardPatch(card, {
      title: 'New title',
      notes_md: 'some notes',
      waiting_on: 'the insurer',
    });
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('updated');
    expect(Object.keys(events[0].detail).sort()).toEqual(['notes_md', 'title', 'waiting_on']);
  });

  it('mixes the two in one save', () => {
    const events = eventsForCardPatch(card, { column_id: 'doing', title: 'New title' });
    expect(events.map((e) => e.action)).toEqual(['moved', 'updated']);
  });
});

describe('eventsForGoalPatch', () => {
  const goal = {
    status: 'planned' as const,
    owner_email: null,
    target_date: null,
    title: 'Train the staff',
    description_md: '',
    area: null,
    parent_id: null,
  };

  it('gives a status change, an assignment, and a target their own lines', () => {
    const events = eventsForGoalPatch(goal, {
      status: 'active',
      owner_email: 'julien@pyresauna.com',
      target_date: '2026-12-31',
    });
    expect(events.map((e) => e.action)).toEqual(['status_changed', 'assigned', 'due_changed']);
  });

  it('collapses the rest, and writes nothing for a no-op', () => {
    expect(eventsForGoalPatch(goal, { title: 'Train the staff' })).toEqual([]);
    const events = eventsForGoalPatch(goal, { title: 'New', area: 'Employees' });
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('updated');
  });
});

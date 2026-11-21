import { describe, expect, it } from 'vitest';
import {
  checkRunSize,
  currentPayload,
  describeSuggestion,
  parsePayload,
  sourceHref,
  stockAfterChange,
} from './types';

const UUID = '0b6c1f8e-2f9a-4c1e-9a55-6a1d2b3c4d5e';

describe('parsePayload board_card.create', () => {
  it('reads a card with defaults', () => {
    expect(
      parsePayload('board_card.create', { board: 'goals', title: '  Replace filter ' })
    ).toEqual({
      ok: true,
      value: {
        board: 'goals',
        columnKey: null,
        title: 'Replace filter',
        notesMd: '',
        dueDate: null,
        assigneeEmails: [],
        severity: null,
        importance: null,
        properties: {},
      },
    });
  });

  it('reads assignees, severity and importance', () => {
    const parsed = parsePayload('board_card.create', {
      board: 'goals',
      title: 'Fix the heater',
      assigneeEmails: ['Jo@pyresauna.com', 'jo@pyresauna.com'],
      severity: 'high',
      importance: 'low',
    });
    expect(parsed.ok && parsed.value).toMatchObject({
      assigneeEmails: ['jo@pyresauna.com'],
      severity: 'high',
      importance: 'low',
    });
  });

  it('refuses an unknown rating or a bad assignee', () => {
    const base = { board: 'goals', title: 'x' };
    expect(parsePayload('board_card.create', { ...base, severity: 'urgent' }).ok).toBe(false);
    expect(parsePayload('board_card.create', { ...base, importance: 'huge' }).ok).toBe(false);
    expect(parsePayload('board_card.create', { ...base, assigneeEmails: ['jo'] }).ok).toBe(false);
  });

  it('refuses a missing title and a bad due date', () => {
    expect(parsePayload('board_card.create', { board: 'goals' }).ok).toBe(false);
    expect(
      parsePayload('board_card.create', { board: 'goals', title: 'x', dueDate: 'Saturday' }).ok
    ).toBe(false);
  });
});

describe('parsePayload board_card.comment', () => {
  it('needs a card id and some words', () => {
    expect(parsePayload('board_card.comment', { cardId: UUID, note: 'Again tonight' })).toEqual({
      ok: true,
      value: { cardId: UUID, note: 'Again tonight' },
    });
    expect(parsePayload('board_card.comment', { cardId: 'nope', note: 'x' }).ok).toBe(false);
    expect(parsePayload('board_card.comment', { cardId: UUID, note: '  ' }).ok).toBe(false);
  });
});

describe('parsePayload sop.edit', () => {
  const base = {
    sopId: UUID,
    slug: 'closing',
    baseVersion: 3,
    title: 'Closing',
    contentMd: '# Closing',
    changeNote: 'Drop the right tub',
    edits: [{ find: 'a', replace: 'b' }],
  };

  it('reads a full edit', () => {
    expect(parsePayload('sop.edit', base)).toEqual({ ok: true, value: base });
  });

  it('refuses a missing base version and malformed hunks', () => {
    expect(parsePayload('sop.edit', { ...base, baseVersion: undefined }).ok).toBe(false);
    expect(parsePayload('sop.edit', { ...base, edits: [{ find: '', replace: 'x' }] }).ok).toBe(
      false
    );
  });
  it('keeps an append hunk (a new last section)', () => {
    const parsed = parsePayload('sop.edit', { ...base, edits: [{ append: '## Late\n- x' }] });
    expect(parsed.ok && parsed.value.edits).toEqual([{ append: '## Late\n- x' }]);
    expect(parsePayload('sop.edit', { ...base, edits: [{ append: '  ' }] }).ok).toBe(false);
  });
});

describe('parsePayload sop.create', () => {
  it('fills the slug, section and access the New SOP form would', () => {
    expect(
      parsePayload('sop.create', { title: 'Late Arrivals', contentMd: '# Late arrivals\n' })
    ).toEqual({
      ok: true,
      value: {
        title: 'Late Arrivals',
        slug: 'late-arrivals',
        category: 'General',
        contentMd: '# Late arrivals\n',
        viewRoles: ['staff', 'shift_lead', 'admin'],
        editRoles: ['admin'],
      },
    });
  });

  it('keeps admins on narrowed access and refuses bad input', () => {
    const parsed = parsePayload('sop.create', {
      title: 'Cash handling',
      category: 'Policies',
      contentMd: 'x',
      viewRoles: ['shift_lead'],
    });
    expect(parsed.ok && parsed.value.viewRoles).toEqual(['shift_lead', 'admin']);
    expect(parsePayload('sop.create', { title: 'X', contentMd: '' }).ok).toBe(false);
    expect(parsePayload('sop.create', { title: 'X', contentMd: 'x', slug: 'Bad Slug' }).ok).toBe(
      false
    );
    expect(parsePayload('sop.create', { title: 'X', contentMd: 'x', viewRoles: [] }).ok).toBe(
      false
    );
  });
});

describe('helpers', () => {
  it('prefers the admin edit over the original', () => {
    expect(currentPayload({ payload: { a: 1 }, edited_payload: null })).toEqual({ a: 1 });
    expect(currentPayload({ payload: { a: 1 }, edited_payload: { a: 2 } })).toEqual({ a: 2 });
  });

  it('describes each kind in a line', () => {
    expect(describeSuggestion('board_card.create', { title: 'Fix heater' })).toBe(
      'New task: Fix heater'
    );
    expect(describeSuggestion('sop.edit', { title: 'Closing' })).toBe('Edit SOP: Closing');
    expect(describeSuggestion('sop.create', { title: 'Late arrivals', category: 'Guests' })).toBe(
      'New SOP: Late arrivals (Guests)'
    );
  });

  it('links back to a shift note', () => {
    expect(sourceHref('shift_note', UUID)).toBe(`/admin/shift-notes#note-${UUID}`);
  });
});

describe('parsePayload inventory.count', () => {
  it('reads a signed change, with a total from the stock that rode along', () => {
    const used = parsePayload('inventory.count', {
      itemId: UUID,
      change: -52,
      previousInStock: 145,
    });
    expect(used.ok && used.value).toMatchObject({ change: -52, inStock: 93 });
    const received = parsePayload('inventory.count', {
      itemId: UUID,
      change: '1',
      previousInStock: 2,
    });
    expect(received.ok && received.value).toMatchObject({ change: 1, inStock: 3 });
    // A set keeps change null, even when it matches the record.
    const same = parsePayload('inventory.count', { itemId: UUID, inStock: 2, previousInStock: 2 });
    expect(same.ok && same.value).toMatchObject({ change: null, inStock: 2 });
  });

  it('refuses a change of zero or past the limit', () => {
    expect(parsePayload('inventory.count', { itemId: UUID, change: 0 }).ok).toBe(false);
    expect(parsePayload('inventory.count', { itemId: UUID, change: 'lots' }).ok).toBe(false);
    expect(parsePayload('inventory.count', { itemId: UUID, change: -200000 }).ok).toBe(false);
  });

  it('works out what a change leaves, refusing to go below zero', () => {
    expect(stockAfterChange(2, -1)).toBe(1);
    expect(stockAfterChange(2, 1)).toBe(3);
    expect(stockAfterChange(2.5, -0.5)).toBe(2);
    expect(stockAfterChange(1, -2)).toBeNull();
  });

  it('describes a change with its sign', () => {
    expect(
      describeSuggestion('inventory.count', { itemName: 'Bath Towels', inStock: 93, change: -52 })
    ).toBe('Inventory count: Bath Towels, 93 in stock (−52)');
  });

  it('reads the item and the number, with the display fields blank until checked', () => {
    expect(parsePayload('inventory.count', { itemId: UUID, inStock: 3 })).toEqual({
      ok: true,
      value: {
        itemId: UUID,
        inStock: 3,
        change: null,
        itemName: '',
        previousInStock: null,
        reorderAt: null,
        lastCountedAt: null,
        lastCountedBy: null,
        countedBy: null,
        countedAt: null,
      },
    });
  });

  it('keeps who counted it and when, and the item as it stood', () => {
    const parsed = parsePayload('inventory.count', {
      itemId: UUID,
      inStock: '12.5',
      itemName: 'Trash bags',
      previousInStock: 20,
      reorderAt: 5,
      lastCountedAt: '2026-11-01T12:00:00Z',
      lastCountedBy: 'Jo@PyreSauna.com',
      countedBy: 'maya@pyresauna.com',
      countedAt: '2026-11-05T21:00:00Z',
    });
    expect(parsed.ok && parsed.value).toMatchObject({
      inStock: 12.5,
      itemName: 'Trash bags',
      previousInStock: 20,
      reorderAt: 5,
      lastCountedBy: 'jo@pyresauna.com',
      countedBy: 'maya@pyresauna.com',
      countedAt: '2026-11-05T21:00:00Z',
    });
  });

  it('refuses a missing item, a negative or absent number, and a bad stamp', () => {
    expect(parsePayload('inventory.count', { inStock: 3 }).ok).toBe(false);
    expect(parsePayload('inventory.count', { itemId: UUID }).ok).toBe(false);
    expect(parsePayload('inventory.count', { itemId: UUID, inStock: -1 }).ok).toBe(false);
    expect(parsePayload('inventory.count', { itemId: UUID, inStock: 'three' }).ok).toBe(false);
    const stamped = parsePayload('inventory.count', {
      itemId: UUID,
      inStock: 3,
      countedAt: 'yesterday',
    });
    expect(stamped.ok && stamped.value.countedAt).toBeNull();
  });

  it('describes the item and the count', () => {
    expect(describeSuggestion('inventory.count', { itemName: 'Trash bags', inStock: 3 })).toBe(
      'Inventory count: Trash bags, 3 in stock'
    );
  });
});

describe('checkRunSize', () => {
  it('lets a run count every supply on a long note, but caps the other kinds at 8', () => {
    expect(checkRunSize(Array(18).fill('inventory.count'))).toBeNull();
    expect(
      checkRunSize([...Array(8).fill('board_card.create'), ...Array(30).fill('inventory.count')])
    ).toBeNull();
    expect(checkRunSize(Array(9).fill('board_card.create'))).toMatch(/besides inventory/);
    expect(checkRunSize(Array(51).fill('inventory.create'))).toMatch(/50 inventory/);
  });
});

describe('parsePayload inventory.create', () => {
  it('reads a name and whatever the note gave, leaving the rest empty', () => {
    expect(
      parsePayload('inventory.create', { name: ' Earplugs ', location: 'Front desk' })
    ).toEqual({
      ok: true,
      value: {
        name: 'Earplugs',
        category: null,
        location: 'Front desk',
        vendor: null,
        inStock: null,
        reorderAt: null,
        countEveryDays: null,
        countedBy: null,
        countedAt: null,
      },
    });
  });

  it('reads typed numbers and keeps who counted it', () => {
    const parsed = parsePayload('inventory.create', {
      name: 'Earplugs',
      inStock: '40',
      reorderAt: 10,
      category: '',
      countedBy: 'Maya@PyreSauna.com',
      countedAt: '2026-11-05T21:00:00Z',
    });
    expect(parsed.ok && parsed.value).toMatchObject({
      inStock: 40,
      reorderAt: 10,
      category: null,
      countedBy: 'maya@pyresauna.com',
      countedAt: '2026-11-05T21:00:00Z',
    });
  });

  it('refuses no name, a bad number, a long field and a bad schedule', () => {
    expect(parsePayload('inventory.create', { name: '  ' }).ok).toBe(false);
    expect(parsePayload('inventory.create', { name: 'Earplugs', inStock: -1 }).ok).toBe(false);
    expect(parsePayload('inventory.create', { name: 'Earplugs', inStock: 'lots' }).ok).toBe(false);
    expect(
      parsePayload('inventory.create', { name: 'Earplugs', category: 'x'.repeat(61) }).ok
    ).toBe(false);
    expect(parsePayload('inventory.create', { name: 'Earplugs', countEveryDays: 0 }).ok).toBe(
      false
    );
  });

  it('describes the item, with its count when it has one', () => {
    expect(describeSuggestion('inventory.create', { name: 'Earplugs', inStock: 40 })).toBe(
      'New inventory item: Earplugs, 40 in stock'
    );
    expect(describeSuggestion('inventory.create', { name: 'Earplugs', inStock: null })).toBe(
      'New inventory item: Earplugs'
    );
  });
});

describe('parsePayload shift_assignment.update', () => {
  it('reads an end time alone, leaving the start to be filled from the assignment', () => {
    const parsed = parsePayload('shift_assignment.update', { assignmentId: UUID, endsAt: '20:30' });
    expect(parsed.ok && parsed.value).toMatchObject({
      assignmentId: UUID,
      startsAt: '',
      endsAt: '20:30',
    });
  });

  it('trims seconds off a time', () => {
    const parsed = parsePayload('shift_assignment.update', {
      assignmentId: UUID,
      startsAt: '15:00:00',
    });
    expect(parsed.ok && parsed.value.startsAt).toBe('15:00');
  });

  it('refuses a payload with no times, a bad time, or no assignment', () => {
    expect(parsePayload('shift_assignment.update', { assignmentId: UUID }).ok).toBe(false);
    expect(
      parsePayload('shift_assignment.update', { assignmentId: UUID, endsAt: '8:30pm' }).ok
    ).toBe(false);
    expect(parsePayload('shift_assignment.update', { endsAt: '20:30' }).ok).toBe(false);
  });

  it('describes the person and their new hours', () => {
    expect(
      describeSuggestion('shift_assignment.update', {
        staffName: 'Sam',
        shiftDate: '2026-10-11',
        startsAt: '16:00',
        endsAt: '20:30',
      })
    ).toBe('Hours change: Sam 2026-10-11 16:00–20:30');
  });
});

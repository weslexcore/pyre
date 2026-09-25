import { describe, expect, it } from 'vitest';
import { currentPayload, describeSuggestion, parsePayload, sourceHref } from './types';

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
        properties: {},
      },
    });
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
  });

  it('links back to a shift note', () => {
    expect(sourceHref('shift_note', UUID)).toBe(`/admin/shift-notes#note-${UUID}`);
  });
});

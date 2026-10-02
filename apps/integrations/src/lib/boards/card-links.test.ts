import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { BoardCardLinkRow, BoardCardRow, BoardFieldRow } from '@/lib/db';
import { prepareLinks, withLinks, withoutLinks } from './card-links';

// A stand-in for the service-role client: every query on a table answers
// with that table's fixture rows, whatever the filters. The link rules under
// test do their own matching on what comes back, which is what is checked.
function fakeDb(tables: Record<string, unknown[]>): SupabaseClient {
  const query = (table: string) => {
    const result = { data: tables[table] ?? [], error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'in', 'eq', 'or', 'order', 'limit']) {
      chain[method] = () => chain;
    }
    // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are awaited, so the fake has to be thenable too.
    chain.then = (resolve: (value: typeof result) => unknown) => resolve(result);
    return chain;
  };
  return { from: query } as unknown as SupabaseClient;
}

const EVENT = 'a0000000-0000-4000-8000-00000000000a';
const MAYA = 'b0000000-0000-4000-8000-00000000000a';
const LEO = 'b0000000-0000-4000-8000-00000000000b';
const PRACTITIONERS = 'c0000000-0000-4000-8000-00000000000a';

function linkField(overrides: Partial<BoardFieldRow> = {}): BoardFieldRow {
  return {
    id: 'f0000000-0000-4000-8000-000000000001',
    board_id: 'events',
    key: 'practitioner',
    label: 'Practitioner',
    kind: 'card_link',
    options: [],
    hint: null,
    show_on_card: true,
    show_label_on_card: true,
    show_on_calendar: false,
    calendar_time_key: null,
    link_board_id: PRACTITIONERS,
    link_columns: ['active'],
    link_multiple: false,
    link_inverse_field_id: null,
    checklist_md: '',
    checklist_done_column: null,
    sort_order: 10,
    archived: false,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

const existing: BoardCardLinkRow = {
  id: 'd0000000-0000-4000-8000-00000000000a',
  field_id: linkField().id,
  from_card_id: EVENT,
  to_card_id: MAYA,
  created_by: 'a@pyresauna.com',
  created_at: '',
};

describe('prepareLinks', () => {
  it('unlinks everything when the answer is sent as null', async () => {
    const db = fakeDb({ board_card_links: [existing] });
    const result = await prepareLinks(db, EVENT, [linkField()], {}, { practitioner: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.links?.removed).toEqual([{ field: 'practitioner', other: MAYA }]);
    expect(result.links?.added).toEqual([]);
  });

  it('leaves links alone when the write does not mention the field', async () => {
    const db = fakeDb({ board_card_links: [existing] });
    const result = await prepareLinks(db, EVENT, [linkField()], { note: 'hi' }, { note: 'hi' });
    expect(result).toEqual({ ok: true, properties: { note: 'hi' }, links: null });
  });

  it('never stores a link answer on the card', async () => {
    const db = fakeDb({ board_card_links: [] });
    const result = await prepareLinks(
      db,
      EVENT,
      [linkField()],
      { practitioner: [], note: 'hi' },
      { practitioner: [], note: 'hi' }
    );
    expect(result.ok && result.properties).toEqual({ note: 'hi' });
  });

  it('refuses a second card on a one-card field', async () => {
    const result = await prepareLinks(
      fakeDb({}),
      EVENT,
      [linkField()],
      { practitioner: [MAYA, LEO] },
      { practitioner: [MAYA, LEO] }
    );
    expect(result).toEqual({ ok: false, error: '"Practitioner" links one card at most' });
  });

  it('refuses a card from a column the field does not link from', async () => {
    const db = fakeDb({
      board_card_links: [],
      board_cards: [{ id: LEO, title: 'Leo', board_id: PRACTITIONERS, column_id: 'col-prospect' }],
      board_columns: [{ id: 'col-prospect', key: 'prospect', label: 'Prospect' }],
    });
    const result = await prepareLinks(
      db,
      EVENT,
      [linkField()],
      { practitioner: [LEO] },
      { practitioner: [LEO] }
    );
    expect(result).toEqual({
      ok: false,
      error: `"Leo" is in Prospect, which "Practitioner" doesn't link from`,
    });
  });

  it('refuses a card on another board', async () => {
    const db = fakeDb({
      board_card_links: [],
      board_cards: [{ id: LEO, title: 'Leo', board_id: 'rentals', column_id: 'col-active' }],
      board_columns: [{ id: 'col-active', key: 'active', label: 'Active' }],
    });
    const result = await prepareLinks(
      db,
      EVENT,
      [linkField()],
      { practitioner: [LEO] },
      { practitioner: [LEO] }
    );
    expect(result).toEqual({ ok: false, error: `"Practitioner" can't link that card` });
  });

  it('takes a card from an allowed column, swapping out the one there', async () => {
    const db = fakeDb({
      board_card_links: [existing],
      board_cards: [{ id: LEO, title: 'Leo', board_id: PRACTITIONERS, column_id: 'col-active' }],
      board_columns: [{ id: 'col-active', key: 'active', label: 'Active' }],
    });
    const result = await prepareLinks(
      db,
      EVENT,
      [linkField()],
      { practitioner: [LEO] },
      { practitioner: [LEO] }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.links?.added).toEqual([{ field: 'practitioner', other: LEO }]);
    expect(result.links?.removed).toEqual([{ field: 'practitioner', other: MAYA }]);
  });

  it('refuses a card whose own end of the pair holds one and is taken', async () => {
    const events = linkField({
      id: 'f0000000-0000-4000-8000-000000000002',
      board_id: 'practitioners',
      key: 'events',
      label: 'Events',
      link_multiple: false,
      link_inverse_field_id: linkField().id,
    });
    const practitioner = linkField({
      link_multiple: true,
      link_columns: [],
      link_inverse_field_id: events.id,
    });
    // Maya is already on another event, and a practitioner's Events field
    // here holds one.
    const otherEvent = 'a0000000-0000-4000-8000-00000000000b';
    const db = fakeDb({
      board_card_links: [{ ...existing, from_card_id: otherEvent }],
      board_cards: [{ id: MAYA, title: 'Maya', board_id: PRACTITIONERS, column_id: 'col-active' }],
      board_columns: [{ id: 'col-active', key: 'active', label: 'Active' }],
      board_fields: [events],
    });
    const result = await prepareLinks(
      db,
      EVENT,
      [practitioner],
      { practitioner: [MAYA] },
      { practitioner: [MAYA] }
    );
    expect(result).toEqual({
      ok: false,
      error: 'Maya already has a card under "Events", which holds one',
    });
  });
});

describe('withLinks / withoutLinks', () => {
  it('reads link answers back onto cards from the rows, and strips stray stored ones', async () => {
    const cards: Pick<BoardCardRow, 'id' | 'properties'>[] = [
      { id: EVENT, properties: { practitioner: ['stale'], note: 'hi' } },
      { id: 'a0000000-0000-4000-8000-00000000000c', properties: {} },
    ];
    const read = await withLinks(fakeDb({}), [linkField()], cards, [existing]);
    expect(read[0].properties).toEqual({ note: 'hi', practitioner: [MAYA] });
    expect(read[1].properties).toEqual({});
    expect(withoutLinks([linkField()], { practitioner: [MAYA], note: 'hi' })).toEqual({
      note: 'hi',
    });
  });
});

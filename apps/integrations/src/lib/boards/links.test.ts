import { describe, expect, it } from 'vitest';
import {
  isLinkBetween,
  type LinkSummary,
  linkAnswers,
  linkColumnAllowed,
  linkDiff,
  linkedTitles,
  linkFieldIds,
  linkIdsOf,
  linkRowFor,
  linkSeenFrom,
  markOpenable,
  normalizeLinkIds,
  summariesById,
} from './links';
import { BOARD_LIMITS } from './types';

// An events board with a Practitioner field, paired with an Events field on
// the practitioners board: the case this was built for.
const PRACTITIONER = {
  id: 'f0000000-0000-4000-8000-000000000001',
  key: 'practitioner',
  kind: 'card_link' as const,
  link_inverse_field_id: 'f0000000-0000-4000-8000-000000000002',
};
const EVENTS = {
  id: 'f0000000-0000-4000-8000-000000000002',
  key: 'events',
  kind: 'card_link' as const,
  link_inverse_field_id: PRACTITIONER.id,
};

const EVENT_A = 'a0000000-0000-4000-8000-00000000000a';
const EVENT_B = 'a0000000-0000-4000-8000-00000000000b';
const MAYA = 'b0000000-0000-4000-8000-00000000000a';
const LEO = 'b0000000-0000-4000-8000-00000000000b';

describe('normalizeLinkIds', () => {
  it('keeps ids once, lowercased, and drops what is not an id', () => {
    expect(normalizeLinkIds([MAYA.toUpperCase(), MAYA, 'nope', 7, LEO])).toEqual([MAYA, LEO]);
  });

  it('clears an answer with nothing usable in it', () => {
    expect(normalizeLinkIds([])).toBeNull();
    expect(normalizeLinkIds('b0000000-0000-4000-8000-00000000000a')).toBeNull();
  });

  it('caps a list at the per-field limit', () => {
    const ids = Array.from(
      { length: BOARD_LIMITS.linksPerField + 5 },
      (_, i) => `c0000000-0000-4000-8000-${String(i).padStart(12, '0')}`
    );
    expect(normalizeLinkIds(ids)).toHaveLength(BOARD_LIMITS.linksPerField);
  });
});

describe('reading a link from either end', () => {
  const row = linkRowFor(PRACTITIONER, EVENT_A, MAYA);

  it('stores a link under the field it was made from, card first', () => {
    expect(row).toEqual({ field_id: PRACTITIONER.id, from_card_id: EVENT_A, to_card_id: MAYA });
  });

  it('reads the row front to back from its own field and back to front from the pair', () => {
    expect(linkSeenFrom(PRACTITIONER, row)).toEqual({ card: EVENT_A, other: MAYA });
    expect(linkSeenFrom(EVENTS, row)).toEqual({ card: MAYA, other: EVENT_A });
  });

  it('reads a link made from the practitioner side just the same', () => {
    const fromTheOtherEnd = linkRowFor(EVENTS, MAYA, EVENT_B);
    expect(linkSeenFrom(PRACTITIONER, fromTheOtherEnd)).toEqual({ card: EVENT_B, other: MAYA });
    expect(linkSeenFrom(EVENTS, fromTheOtherEnd)).toEqual({ card: MAYA, other: EVENT_B });
  });

  it('ignores rows that belong to an unrelated field', () => {
    const oneWay = { id: 'f0000000-0000-4000-8000-000000000009', link_inverse_field_id: null };
    expect(linkSeenFrom(oneWay, row)).toBeNull();
  });

  it('matches the link to unlink from either end', () => {
    expect(isLinkBetween(PRACTITIONER, row, EVENT_A, MAYA)).toBe(true);
    expect(isLinkBetween(EVENTS, row, MAYA, EVENT_A)).toBe(true);
    expect(isLinkBetween(EVENTS, row, EVENT_A, MAYA)).toBe(false);
  });

  it('asks for both halves of a pair when loading a board', () => {
    expect(linkFieldIds([PRACTITIONER]).sort()).toEqual([PRACTITIONER.id, EVENTS.id].sort());
    expect(linkFieldIds([{ ...PRACTITIONER, kind: 'text' as const }])).toEqual([]);
  });
});

describe('linkAnswers', () => {
  const rows = [
    linkRowFor(PRACTITIONER, EVENT_A, MAYA),
    linkRowFor(EVENTS, MAYA, EVENT_B),
    linkRowFor(PRACTITIONER, EVENT_B, LEO),
  ];

  it('gives each event its practitioners', () => {
    const answers = linkAnswers([PRACTITIONER], rows);
    expect(answers.get(EVENT_A)).toEqual({ practitioner: [MAYA] });
    expect(answers.get(EVENT_B)).toEqual({ practitioner: [MAYA, LEO] });
  });

  it('gives each practitioner their events, whichever side made the link', () => {
    const answers = linkAnswers([EVENTS], rows);
    expect(answers.get(MAYA)).toEqual({ events: [EVENT_A, EVENT_B] });
    expect(answers.get(LEO)).toEqual({ events: [EVENT_B] });
  });

  it('shows a link stored from both ends once', () => {
    const doubled = [linkRowFor(PRACTITIONER, EVENT_A, MAYA), linkRowFor(EVENTS, MAYA, EVENT_A)];
    expect(linkAnswers([PRACTITIONER], doubled).get(EVENT_A)).toEqual({ practitioner: [MAYA] });
  });

  it('works on one board: a task blocked by another task', () => {
    const blockedBy = {
      id: 'f0000000-0000-4000-8000-00000000000b',
      key: 'blocked_by',
      kind: 'card_link' as const,
      link_inverse_field_id: 'f0000000-0000-4000-8000-00000000000c',
    };
    const blocks = {
      id: 'f0000000-0000-4000-8000-00000000000c',
      key: 'blocks',
      kind: 'card_link' as const,
      link_inverse_field_id: blockedBy.id,
    };
    const answers = linkAnswers([blockedBy, blocks], [linkRowFor(blockedBy, EVENT_A, EVENT_B)]);
    expect(answers.get(EVENT_A)).toEqual({ blocked_by: [EVENT_B] });
    expect(answers.get(EVENT_B)).toEqual({ blocks: [EVENT_A] });
  });
});

describe('linkDiff', () => {
  const fields = [
    { key: 'practitioner', kind: 'card_link' as const },
    { key: 'notes', kind: 'text' as const },
  ];

  it('says which links a write makes and which it undoes', () => {
    expect(
      linkDiff(fields, { practitioner: [MAYA] }, { practitioner: [LEO], notes: 'hi' })
    ).toEqual({
      added: [{ field: 'practitioner', other: LEO }],
      removed: [{ field: 'practitioner', other: MAYA }],
    });
  });

  it('undoes every link when the answer is cleared', () => {
    expect(linkDiff(fields, { practitioner: [MAYA] }, { practitioner: null })).toEqual({
      added: [],
      removed: [{ field: 'practitioner', other: MAYA }],
    });
  });

  it('leaves a field the write does not mention alone', () => {
    expect(linkDiff(fields, { practitioner: [MAYA] }, { notes: 'hi' })).toEqual({
      added: [],
      removed: [],
    });
  });
});

describe('picking and showing linked cards', () => {
  it('offers any column when none is named, and only the named ones otherwise', () => {
    expect(linkColumnAllowed({ link_columns: [] }, 'prospect')).toBe(true);
    const working = { link_columns: ['onboarded', 'active', 'inactive'] };
    expect(linkColumnAllowed(working, 'active')).toBe(true);
    expect(linkColumnAllowed(working, 'prospect')).toBe(false);
  });

  const summary = (id: string, title: string, slug = 'practitioners'): LinkSummary => ({
    id,
    title,
    board_slug: slug,
    board_name: 'Practitioners',
    column_key: 'active',
    column_label: 'Active',
    column_kind: 'open',
    openable: false,
  });

  it('shows titles in link order, skipping a card it knows nothing about', () => {
    const known = summariesById([summary(MAYA, 'Maya'), summary(LEO, 'Leo')]);
    expect(linkedTitles([LEO, EVENT_A, MAYA], known)).toEqual(['Leo', 'Maya']);
    expect(linkIdsOf('not a list')).toEqual([]);
  });

  it('lets a viewer open only the boards they may open', () => {
    const marked = markOpenable(
      [summary(MAYA, 'Maya'), summary(EVENT_A, 'Sauna Social', 'events')],
      (slug) => slug === 'events'
    );
    expect(marked.map((entry) => entry.openable)).toEqual([false, true]);
  });
});

import { describe, expect, it } from 'vitest';
import type { BoardFieldRow } from '@/lib/db';
import { cardMatches, cardSearchText, searchTerms } from './search';

const PEOPLE = { 'jose@pyresauna.com': 'José Ramírez' };

const field = (over: Partial<BoardFieldRow>): BoardFieldRow =>
  ({ key: 'x', label: 'X', kind: 'text', options: [], ...over }) as BoardFieldRow;

const FIELDS = [
  field({ key: 'contact', label: 'Contact', kind: 'text' }),
  field({ key: 'window', label: 'Requested window', kind: 'time_range' }),
  field({ key: 'deposit', label: 'Deposit paid', kind: 'yes_no' }),
];

const card = {
  title: 'Birthday buyout for Dana',
  notes_md: 'Wants the **cold plunge** open late.',
  owner_email: 'jose@pyresauna.com' as string | null,
  waiting_on: 'the insurer' as string | null,
  area: 'Events' as string | null,
  properties: { contact: 'dana@example.com', window: ['18:30', '21:00'], deposit: true },
};

describe('searchTerms', () => {
  it('splits on whitespace, folds case and accents, and drops blanks', () => {
    expect(searchTerms('  Cold  PLUNGE ')).toEqual(['cold', 'plunge']);
    expect(searchTerms('José')).toEqual(['jose']);
    expect(searchTerms('   ')).toEqual([]);
  });
});

describe('cardSearchText', () => {
  it('includes the owner by name, the fields by shown answer, and the notes', () => {
    const text = cardSearchText(card, FIELDS, PEOPLE);
    expect(text).toContain('jose ramirez');
    expect(text).toContain('6:30 pm – 9:00 pm');
    expect(text).toContain('deposit paid');
    expect(text).toContain('yes');
    expect(text).toContain('cold plunge');
    expect(text).toContain('the insurer');
  });
});

describe('cardMatches', () => {
  it('matches everything when there is no query', () => {
    expect(cardMatches(card, [], FIELDS, PEOPLE)).toBe(true);
  });

  it('needs every word, in any order, anywhere on the card', () => {
    expect(cardMatches(card, searchTerms('dana plunge'), FIELDS, PEOPLE)).toBe(true);
    expect(cardMatches(card, searchTerms('jose 6:30'), FIELDS, PEOPLE)).toBe(true);
    expect(cardMatches(card, searchTerms('dana towels'), FIELDS, PEOPLE)).toBe(false);
  });

  it('finds a card by an answer the card shows rather than what it stores', () => {
    expect(cardMatches(card, searchTerms('9:00 pm'), FIELDS, PEOPLE)).toBe(true);
    expect(cardMatches(card, searchTerms('true'), FIELDS, PEOPLE)).toBe(false);
  });

  it('copes with a card that has nothing optional filled in', () => {
    const bare = { ...card, owner_email: null, waiting_on: null, area: null, properties: {} };
    expect(cardMatches(bare, searchTerms('birthday'), FIELDS, {})).toBe(true);
    expect(cardMatches(bare, searchTerms('jose'), FIELDS, {})).toBe(false);
  });
});

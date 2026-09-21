import { describe, expect, it } from 'vitest';
import {
  boardGrantKey,
  boardSlugFromGrant,
  COLUMN_KIND_HINTS,
  COLUMN_KIND_LABELS,
  COLUMN_KINDS,
  FIELD_KIND_LABELS,
  FIELD_KINDS,
  isBoardGrantKey,
  isBoardSlug,
  isColumnKind,
  isFieldKind,
  isFinishedKind,
  kindHasOptions,
  slugOf,
} from './types';

describe('grant keys', () => {
  it('round-trips a slug', () => {
    expect(boardGrantKey('rentals')).toBe('board:rentals');
    expect(boardSlugFromGrant('board:rentals')).toBe('rentals');
  });

  it('tells a board grant from a page href or a capability', () => {
    expect(isBoardGrantKey('board:rentals')).toBe(true);
    expect(isBoardGrantKey('board:')).toBe(false);
    expect(isBoardGrantKey('/admin/boards')).toBe(false);
    expect(isBoardGrantKey('guests:manage')).toBe(false);
    expect(boardSlugFromGrant('/admin/boards')).toBe('');
  });
});

describe('slugOf', () => {
  it('suggests a slug from a name', () => {
    expect(slugOf('Rental & group leads')).toBe('rental-group-leads');
    expect(slugOf('  Partnerships  ')).toBe('partnerships');
    expect(slugOf('Merch 2026')).toBe('merch-2026');
  });

  it('gives back nothing when there is nothing usable', () => {
    // The constraint wants a leading letter, so a name that slugs to digits
    // or punctuation has no suggestion to offer.
    expect(slugOf('2026')).toBe('');
    expect(slugOf('!!!')).toBe('');
    expect(slugOf('a')).toBe(''); // one character is below the minimum
  });
});

describe('isBoardSlug', () => {
  it('matches the column constraint', () => {
    expect(isBoardSlug('rentals')).toBe(true);
    expect(isBoardSlug('group-bookings')).toBe(true);
    expect(isBoardSlug('Rentals')).toBe(false);
    expect(isBoardSlug('1rentals')).toBe(false);
    expect(isBoardSlug('a')).toBe(false);
  });
});

describe('kind guards', () => {
  it('accepts exactly the listed kinds', () => {
    for (const kind of COLUMN_KINDS) expect(isColumnKind(kind)).toBe(true);
    expect(isColumnKind('waiting')).toBe(false);
    for (const kind of FIELD_KINDS) expect(isFieldKind(kind)).toBe(true);
    expect(isFieldKind('email')).toBe(false);
  });

  it('counts both done and dropped as finished', () => {
    expect(isFinishedKind('done')).toBe(true);
    expect(isFinishedKind('dropped')).toBe(true);
    expect(isFinishedKind('open')).toBe(false);
  });

  it('knows which field kinds need options', () => {
    expect(kindHasOptions('choice')).toBe(true);
    expect(kindHasOptions('multi_choice')).toBe(true);
    expect(kindHasOptions('date')).toBe(false);
    expect(kindHasOptions('text')).toBe(false);
  });
});

describe('label records', () => {
  it('covers every kind', () => {
    for (const kind of COLUMN_KINDS) {
      expect(COLUMN_KIND_LABELS[kind]).toBeTruthy();
      expect(COLUMN_KIND_HINTS[kind]).toBeTruthy();
    }
    for (const kind of FIELD_KINDS) expect(FIELD_KIND_LABELS[kind]).toBeTruthy();
  });
});

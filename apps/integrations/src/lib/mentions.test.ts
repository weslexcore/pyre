import { describe, expect, it } from 'vitest';
import type { RosterRow } from '@/lib/notifications/recipients';
import {
  markdownWithMentions,
  matchMentions,
  mentionCandidates,
  mentionedAddresses,
  mentionedEmails,
  mentionFromHref,
  mentionQuery,
  mentionSegments,
  mentionsAsNames,
  newMentions,
  pageMentionCandidates,
} from './mentions';

const person = (id: string, overrides: Partial<RosterRow> = {}): RosterRow => ({
  id,
  email: `${id}@pyre.test`,
  display_name: id,
  active: true,
  is_admin: false,
  is_shift_lead: false,
  pages: [],
  ...overrides,
});

const people = [
  { name: 'Ada', email: 'a@pyre.test' },
  { name: 'Bo', email: 'b@pyre.test' },
];
const names = { 'a@pyre.test': 'Ada', 'b@pyre.test': 'Bo' };

describe('mention candidates', () => {
  it('keeps rows the test lets through, by name, whether or not they are schedulable', () => {
    expect(
      mentionCandidates(
        [
          person('zed', { active: false }),
          person('amy'),
          person('none', { email: null }),
          person('out'),
        ],
        (row) => row.id !== 'out'
      )
    ).toEqual([
      { email: 'amy@pyre.test', name: 'amy', isAdmin: false },
      { email: 'zed@pyre.test', name: 'zed', isAdmin: false },
    ]);
  });

  it("offers a page's holders and nobody without a dashboard", () => {
    expect(
      pageMentionCandidates(
        [
          person('admin', { is_admin: true, pages: ['/admin/shift-notes'] }),
          person('holder', { pages: ['/admin/shift-notes'] }),
          person('other', { pages: ['/admin/water'] }),
          person('roster-only'),
        ],
        '/admin/shift-notes'
      ).map((p) => p.email)
    ).toEqual(['admin@pyre.test', 'holder@pyre.test']);
  });
});

describe('reading mentions', () => {
  it('recognizes explicit mentions with punctuation, normalizes and deduplicates them', () => {
    expect(mentionedEmails('Hi @A@pyre.test, (@b@pyre.test)! @a@pyre.test.', people)).toEqual([
      'a@pyre.test',
      'b@pyre.test',
    ]);
    expect(
      mentionedEmails('a@pyre.test x@a@pyre.test @unknown@pyre.test @a@pyre.test.evil', people)
    ).toEqual([]);
  });

  it('lists every address written as a mention, known or not', () => {
    expect(mentionedAddresses('@a@pyre.test and @who@else.test, not me@pyre.test')).toEqual([
      'a@pyre.test',
      'who@else.test',
    ]);
  });

  it('finds only the people an edit adds', () => {
    expect(newMentions('@a@pyre.test hi', '@a@pyre.test hi @b@pyre.test', people)).toEqual([
      'b@pyre.test',
    ]);
    expect(newMentions('@a@pyre.test', 'nobody', people)).toEqual([]);
  });

  it('finds a query at the caret without treating normal email as a trigger', () => {
    expect(mentionQuery('Hi @May after', 7)).toEqual({ start: 3, query: 'may' });
    expect(mentionQuery('Hi @', 4)).toEqual({ start: 3, query: '' });
    expect(mentionQuery('a@pyre.test', 11)).toBeNull();
  });

  it('matches the query against names and addresses', () => {
    expect(matchMentions(people, 'AD').map((p) => p.email)).toEqual(['a@pyre.test']);
    expect(matchMentions(people, 'pyre', 1)).toHaveLength(1);
  });
});

describe('drawing mentions', () => {
  it('cuts text at the mentions it knows and leaves the rest alone', () => {
    expect(mentionSegments('Hey @a@pyre.test, ask @x@pyre.test.', names)).toEqual([
      { text: 'Hey ' },
      { text: '@a@pyre.test', mention: { email: 'a@pyre.test', name: 'Ada' } },
      { text: ', ask @x@pyre.test.' },
    ]);
    expect(mentionSegments('@B@pyre.test', names)).toEqual([
      { text: '@B@pyre.test', mention: { email: 'b@pyre.test', name: 'Bo' } },
    ]);
  });

  it('reads mentions as names in an excerpt', () => {
    expect(mentionsAsNames('@a@pyre.test can you check with @b@pyre.test?', names)).toBe(
      '@Ada can you check with @Bo?'
    );
  });

  it('rewrites mentions as chip links, outside code', () => {
    expect(
      markdownWithMentions('Hi @a@pyre.test, see `@b@pyre.test` and\n```\n@a@pyre.test\n```', names)
    ).toBe('Hi [@Ada](#mention-a@pyre.test), see `@b@pyre.test` and\n```\n@a@pyre.test\n```');
    expect(markdownWithMentions('plain', names)).toBe('plain');
    expect(mentionFromHref('#mention-a@pyre.test')).toBe('a@pyre.test');
    expect(mentionFromHref('/admin/sops/x')).toBeNull();
  });
});

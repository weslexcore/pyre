import { describe, expect, it } from 'vitest';
import { matchNote, threadMatches } from './search';

const staff = { email: 'sam@pyre.test', isAdmin: false };
const admin = { email: 'admin@pyre.test', isAdmin: true };

const thread = [
  {
    body: 'Marked resolved',
    author_email: 'admin@pyre.test',
    is_private: false,
    kind: 'status' as const,
  },
  {
    body: 'The spare filters live in the back closet',
    author_email: 'admin@pyre.test',
    is_private: false,
    kind: 'comment' as const,
  },
  {
    body: 'Supplier invoice is disputed',
    author_email: 'admin@pyre.test',
    is_private: true,
    kind: 'comment' as const,
  },
];

describe('matchNote', () => {
  it('prefers the note itself', () => {
    expect(matchNote('Filters are low', thread, 'filters', staff)).toEqual({
      snippet: 'Filters are low',
    });
  });

  it('finds a note by a comment, naming who wrote it', () => {
    expect(matchNote('Running low on things', thread, 'back closet', staff)).toEqual({
      snippet: 'The spare filters live in the back closet',
      replyAuthor: 'admin@pyre.test',
    });
  });

  it('keeps private comments to admins, and never matches events', () => {
    expect(matchNote('Running low', thread, 'invoice', staff)).toBeNull();
    expect(matchNote('Running low', thread, 'invoice', admin)?.replyAuthor).toBe('admin@pyre.test');
    expect(matchNote('Running low', thread, 'resolved', admin)).toBeNull();
  });
});

describe('threadMatches', () => {
  it('keeps a note in the log when only a readable comment matches', () => {
    expect(threadMatches('Running low', thread, 'closet', staff)).toBe(true);
    expect(threadMatches('Running low', thread, 'invoice', staff)).toBe(false);
    expect(threadMatches('Running low', thread, 'invoice', admin)).toBe(true);
    expect(threadMatches('Running low', [], 'closet', staff)).toBe(false);
  });
});

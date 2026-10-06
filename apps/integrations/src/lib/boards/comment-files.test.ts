import { describe, expect, it } from 'vitest';
import { commentNoticeText } from './comment';
import { MAX_FILES_PER_COMMENT, normalizeCommentFileIds } from './files';

const id = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('normalizeCommentFileIds', () => {
  it('keeps ids once, lowercased, in order, and capped', () => {
    expect(normalizeCommentFileIds([id(2), id(1).toUpperCase(), id(2), 'nope', 7])).toEqual([
      id(2),
      id(1),
    ]);
    const many = Array.from({ length: MAX_FILES_PER_COMMENT + 3 }, (_, n) => id(n + 1));
    expect(normalizeCommentFileIds(many)).toHaveLength(MAX_FILES_PER_COMMENT);
  });

  it('is nothing for anything that is not a list', () => {
    expect(normalizeCommentFileIds(undefined)).toEqual([]);
    expect(normalizeCommentFileIds(id(1))).toEqual([]);
  });
});

describe('commentNoticeText', () => {
  it("is the comment's words when it has some", () => {
    expect(commentNoticeText('See the photo', 2)).toBe('See the photo');
  });

  it('says what was shared when there are no words', () => {
    expect(commentNoticeText('', 1)).toBe('Shared a file.');
    expect(commentNoticeText('  ', 3)).toBe('Shared 3 files.');
  });
});

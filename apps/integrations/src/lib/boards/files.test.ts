import { describe, expect, it } from 'vitest';
import {
  adminAttachmentHref,
  attachmentDiff,
  fileFieldKeys,
  fileIdsOf,
  formatFileCount,
  formMediaHref,
  isAttachmentId,
  MAX_FILES_PER_FIELD,
  normalizeFileIds,
} from './files';

const A = '3f1b8a2c-7d4e-4a1b-9c2d-5e6f7a8b9c0d';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const C = '1111aaaa-2222-4bbb-8ccc-3333dddd4444';

const fields = [
  { key: 'contract', kind: 'files' as const },
  { key: 'photos', kind: 'files' as const },
  { key: 'notes', kind: 'text' as const },
];

describe('normalizeFileIds', () => {
  it('keeps ids, once each, lowercased, and drops everything else', () => {
    expect(normalizeFileIds([A, A.toUpperCase(), 'nope', 3, B])).toEqual([A, B]);
  });

  it('is null for a non-list or an empty one', () => {
    expect(normalizeFileIds('x')).toBeNull();
    expect(normalizeFileIds([])).toBeNull();
    expect(normalizeFileIds(['nope'])).toBeNull();
  });

  it('caps the list at the per-field limit', () => {
    const ids = Array.from({ length: MAX_FILES_PER_FIELD + 3 }, (_, i) =>
      A.replace(/^.{8}/, String(i).padStart(8, '0'))
    );
    expect(normalizeFileIds(ids)).toHaveLength(MAX_FILES_PER_FIELD);
  });
});

describe('fileIdsOf and isAttachmentId', () => {
  it('reads the ids out of a stored answer and nothing out of anything else', () => {
    expect(fileIdsOf([A, 'junk', B])).toEqual([A, B]);
    expect(fileIdsOf('a string')).toEqual([]);
    expect(fileIdsOf(undefined)).toEqual([]);
    expect(isAttachmentId(A)).toBe(true);
    expect(isAttachmentId('3f1b8a2c')).toBe(false);
  });
});

describe('fileFieldKeys and attachmentDiff', () => {
  it('names only the files fields', () => {
    expect(fileFieldKeys(fields)).toEqual(['contract', 'photos']);
  });

  it('tells added from removed from still listed, across files fields only', () => {
    const diff = attachmentDiff(
      fields,
      { contract: [A], photos: [B], notes: C },
      { contract: [A, C], notes: 'changed' }
    );
    expect(diff.listed.sort()).toEqual([A, C].sort());
    expect(diff.added).toEqual([C]);
    expect(diff.removed).toEqual([B]);
  });

  it('is empty when nothing about the files changed', () => {
    const diff = attachmentDiff(fields, { contract: [A] }, { contract: [A], notes: 'x' });
    expect(diff).toEqual({ listed: [A], added: [], removed: [] });
  });
});

describe('formatting and hrefs', () => {
  it('counts files in words', () => {
    expect(formatFileCount(1)).toBe('1 file');
    expect(formatFileCount(4)).toBe('4 files');
  });

  it('points a viewer at the signed redirect and a form at its own door', () => {
    expect(adminAttachmentHref(A)).toBe(`/api/admin/board-media?id=${A}`);
    expect(adminAttachmentHref(A, true)).toBe(`/api/admin/board-media?id=${A}&download=1`);
    expect(formMediaHref('rentals')).toBe('/api/forms/rentals/media');
  });
});

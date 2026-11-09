import { describe, expect, it } from 'vitest';
import {
  checkSopMediaFile,
  insertBlock,
  kindForMime,
  parseSopMediaRef,
  parseStartTime,
  sopMediaIdsIn,
  sopMediaMarkdown,
  sopMediaStoragePath,
  titleFromFileName,
} from './media';

const ID = '3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c';
const OTHER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('parseSopMediaRef', () => {
  it('reads a library video reference, with or without a start time', () => {
    expect(parseSopMediaRef(`/api/admin/sop-videos/${ID}`)).toEqual({
      kind: 'video',
      id: ID,
      start: null,
    });
    expect(parseSopMediaRef(`/api/admin/sop-videos/${ID}#t=1:30`)).toEqual({
      kind: 'video',
      id: ID,
      start: 90,
    });
  });

  it('reads a library image reference', () => {
    expect(parseSopMediaRef(`/api/admin/sop-images/${ID}`)).toEqual({
      kind: 'image',
      id: ID,
      start: null,
    });
    // A start time means nothing on an image.
    expect(parseSopMediaRef(`/api/admin/sop-images/${ID}#t=5`)?.start).toBeNull();
  });

  it('ignores anything else', () => {
    expect(parseSopMediaRef('/admin/sops/opening')).toBeNull();
    expect(parseSopMediaRef('https://youtube.com/watch?v=abc')).toBeNull();
    expect(parseSopMediaRef('/api/admin/sop-videos/not-a-uuid')).toBeNull();
    expect(parseSopMediaRef(`/api/admin/sop-media/${ID}`)).toBeNull();
    expect(parseSopMediaRef(`https://evil.example/api/admin/sop-images/${ID}`)).toBeNull();
    expect(parseSopMediaRef(undefined)).toBeNull();
  });
});

describe('parseStartTime', () => {
  it('reads seconds, m:ss and h:mm:ss', () => {
    expect(parseStartTime('90')).toBe(90);
    expect(parseStartTime('2:05')).toBe(125);
    expect(parseStartTime('1:00:10')).toBe(3610);
    expect(parseStartTime('abc')).toBeNull();
  });
});

describe('sopMediaIdsIn', () => {
  it('lists each referenced file once, in order, across both kinds', () => {
    const md = `Intro\n\n![A](/api/admin/sop-videos/${OTHER})\n\n![photo](/api/admin/sop-images/${ID})\n\n![A again](/api/admin/sop-videos/${OTHER}#t=10)`;
    expect(sopMediaIdsIn(md)).toEqual([OTHER, ID]);
  });
});

describe('sopMediaMarkdown', () => {
  it('builds the embed for each kind and keeps brackets out of the alt text', () => {
    expect(sopMediaMarkdown({ kind: 'video', id: ID, title: 'Banking [the] stove' })).toBe(
      `![Banking the stove](/api/admin/sop-videos/${ID})`
    );
    expect(sopMediaMarkdown({ kind: 'image', id: ID, title: 'Breaker panel' })).toBe(
      `![Breaker panel](/api/admin/sop-images/${ID})`
    );
  });
});

describe('insertBlock', () => {
  it('puts the block on its own lines after the caret line', () => {
    expect(insertBlock('First line\nSecond line', '![v](x)', 3)).toBe(
      'First line\n\n![v](x)\n\nSecond line'
    );
  });

  it('appends when the caret is unknown', () => {
    expect(insertBlock('Body\n', '![v](x)', null)).toBe('Body\n\n![v](x)\n');
    expect(insertBlock('', '![v](x)', null)).toBe('![v](x)\n');
  });
});

describe('upload rules', () => {
  it('sorts files by type', () => {
    expect(kindForMime('image/PNG')).toBe('image');
    expect(kindForMime('video/mp4; codecs=avc1')).toBe('video');
    expect(kindForMime('image/heic')).toBeNull();
    expect(kindForMime('application/pdf')).toBeNull();
  });

  it('holds each kind to its own size limit', () => {
    expect(
      checkSopMediaFile({ name: 'a.mp4', type: 'video/mp4', size: 100 * 1024 * 1024 })
    ).toBeNull();
    expect(
      checkSopMediaFile({ name: 'a.jpg', type: 'image/jpeg', size: 100 * 1024 * 1024 })
    ).toMatch(/20 MB limit for images/);
    expect(
      checkSopMediaFile({ name: 'a.mp4', type: 'video/mp4', size: 600 * 1024 * 1024 })
    ).toMatch(/500 MB limit for videos/);
    expect(checkSopMediaFile({ name: 'a.pdf', type: 'application/pdf', size: 10 })).toMatch(/only/);
    expect(checkSopMediaFile({ name: 'a.png', type: 'image/png', size: 0 })).toMatch(/empty/);
  });

  it('names objects by kind, id and type', () => {
    expect(sopMediaStoragePath(ID, 'video/quicktime')).toBe(`videos/${ID}.mov`);
    expect(sopMediaStoragePath(ID, 'image/jpeg')).toBe(`images/${ID}.jpg`);
    expect(titleFromFileName('banking-the_stove.mp4')).toBe('banking the stove');
  });
});

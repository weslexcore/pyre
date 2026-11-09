import { describe, expect, it } from 'vitest';
import {
  checkSopVideoFile,
  insertBlock,
  parseSopVideoRef,
  parseStartTime,
  sopVideoIdsIn,
  sopVideoMarkdown,
  sopVideoStoragePath,
  titleFromFileName,
} from './videos';

const ID = '3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c';
const OTHER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('parseSopVideoRef', () => {
  it('reads a library video reference', () => {
    expect(parseSopVideoRef(`/api/admin/sop-videos/${ID}`)).toEqual({ id: ID, start: null });
  });

  it('reads a start time', () => {
    expect(parseSopVideoRef(`/api/admin/sop-videos/${ID}#t=1:30`)).toEqual({ id: ID, start: 90 });
    expect(parseSopVideoRef(`/api/admin/sop-videos/${ID}#t=45`)).toEqual({ id: ID, start: 45 });
  });

  it('ignores anything else', () => {
    expect(parseSopVideoRef('/admin/sops/opening')).toBeNull();
    expect(parseSopVideoRef('https://youtube.com/watch?v=abc')).toBeNull();
    expect(parseSopVideoRef('/api/admin/sop-videos/not-a-uuid')).toBeNull();
    expect(parseSopVideoRef(`https://evil.example/api/admin/sop-videos/${ID}`)).toBeNull();
    expect(parseSopVideoRef(undefined)).toBeNull();
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

describe('sopVideoIdsIn', () => {
  it('lists each referenced video once, in order', () => {
    const md = `Intro\n\n![A](/api/admin/sop-videos/${OTHER})\n\n[watch](/api/admin/sop-videos/${ID}#t=10)\n\n![A again](/api/admin/sop-videos/${OTHER})`;
    expect(sopVideoIdsIn(md)).toEqual([OTHER, ID]);
  });
});

describe('sopVideoMarkdown', () => {
  it('builds the embed and keeps brackets out of the alt text', () => {
    expect(sopVideoMarkdown({ id: ID, title: 'Banking [the] stove' })).toBe(
      `![Banking the stove](/api/admin/sop-videos/${ID})`
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
  it('accepts videos within the limit and rejects the rest', () => {
    expect(checkSopVideoFile({ name: 'a.mp4', type: 'video/mp4', size: 1000 })).toBeNull();
    expect(checkSopVideoFile({ name: 'a.png', type: 'image/png', size: 1000 })).toMatch(/only/);
    expect(
      checkSopVideoFile({ name: 'a.mp4', type: 'video/mp4', size: 600 * 1024 * 1024 })
    ).toMatch(/limit/);
    expect(checkSopVideoFile({ name: 'a.mp4', type: 'video/mp4', size: 0 })).toMatch(/empty/);
  });

  it('names objects by id and type', () => {
    expect(sopVideoStoragePath(ID, 'video/quicktime')).toBe(`videos/${ID}.mov`);
    expect(titleFromFileName('banking-the_stove.mp4')).toBe('banking the stove');
  });
});

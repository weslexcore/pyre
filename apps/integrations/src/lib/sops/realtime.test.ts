import { describe, expect, it } from 'vitest';
import { collectOthers, presenceByItem, sopTopic } from './realtime';

describe('collectOthers', () => {
  it('lists everyone but the viewer, one entry per person, newest tab winning', () => {
    const others = collectOthers(
      {
        a: [{ email: 'Sam@Example.test', name: 'Sam', item: 2, at: '2026-11-08T10:00:00Z' }],
        b: [{ email: 'sam@example.test', name: 'Sam', item: 4, at: '2026-11-08T10:05:00Z' }],
        c: [{ email: 'me@example.test', name: 'Me', item: 1, at: '2026-11-08T10:06:00Z' }],
        d: [{ email: 'ada@example.test', name: '', at: '2026-11-08T09:00:00Z' }],
      },
      'ME@example.test'
    );
    expect(others).toEqual([
      { email: 'ada@example.test', name: 'ada', item: null, at: '2026-11-08T09:00:00Z' },
      { email: 'sam@example.test', name: 'Sam', item: 4, at: '2026-11-08T10:05:00Z' },
    ]);
  });

  it('ignores entries without an email', () => {
    expect(collectOthers({ a: [{ name: 'Nobody', item: 1, at: 'x' }] }, 'me@x.test')).toEqual([]);
  });
});

describe('presenceByItem', () => {
  it('groups names under the item each person is on', () => {
    const map = presenceByItem([
      { email: 'a@x.test', name: 'Ada', item: 3, at: '' },
      { email: 'b@x.test', name: 'Bo', item: 3, at: '' },
      { email: 'c@x.test', name: 'Cy', item: null, at: '' },
    ]);
    expect(map.get(3)).toEqual(['Ada', 'Bo']);
    expect(map.size).toBe(1);
  });
});

describe('sopTopic', () => {
  it('names the document channel', () => {
    expect(sopTopic('0b6e6f7c-1234-4abc-8def-0123456789ab')).toBe(
      'sop:0b6e6f7c-1234-4abc-8def-0123456789ab'
    );
  });
});

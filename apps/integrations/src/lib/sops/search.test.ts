import { describe, expect, it } from 'vitest';
import { countMatches, highlightSegments, searchContent, searchEntries } from './search';

describe('countMatches', () => {
  it('counts case-insensitively', () => {
    expect(countMatches('Sauna sauna SAUNA', 'sauna')).toBe(3);
  });

  it('counts multiple hits on one line and zero on none', () => {
    expect(countMatches('wood + stage wood', 'wood')).toBe(2);
    expect(countMatches('plunge', 'sauna')).toBe(0);
    expect(countMatches('anything', '')).toBe(0);
  });
});

describe('highlightSegments', () => {
  it('marks matches and preserves original casing', () => {
    expect(highlightSegments('Wipe Sauna glass', 'sauna')).toEqual([
      { text: 'Wipe ', match: false },
      { text: 'Sauna', match: true },
      { text: ' glass', match: false },
    ]);
  });

  it('handles matches at the ends and adjacent matches', () => {
    expect(highlightSegments('abab', 'ab')).toEqual([
      { text: 'ab', match: true },
      { text: 'ab', match: true },
    ]);
  });

  it('returns the whole text unmarked when nothing matches', () => {
    expect(highlightSegments('no hits here', 'sauna')).toEqual([
      { text: 'no hits here', match: false },
    ]);
  });
});

describe('searchContent', () => {
  const doc = `## Large Sauna

- [ ] Uncover wood + stage wood under anteroom bench
- [ ] Wipe sauna glass

> **Ongoing:** check sauna progress / add wood throughout.
`;

  it('counts every occurrence and returns cleaned snippet lines', () => {
    const result = searchContent(doc, 'wood');
    expect(result.count).toBe(3);
    expect(result.snippets[0]).toBe('Uncover wood + stage wood under anteroom bench');
  });

  it('strips heading and checkbox tokens from snippets', () => {
    const result = searchContent(doc, 'sauna');
    expect(result.snippets).toContain('Large Sauna');
    expect(result.snippets).toContain('Wipe sauna glass');
    expect(result.snippets.every((s) => !s.includes('##') && !s.includes('[ ]'))).toBe(true);
  });

  it('caps snippets but keeps counting', () => {
    const result = searchContent('ash\nash\nash\nash\nash', 'ash', 2);
    expect(result.count).toBe(5);
    expect(result.snippets).toHaveLength(2);
  });

  it('windows long lines around the match with ellipses', () => {
    const long = `${'x'.repeat(100)} sauna ${'y'.repeat(120)}`;
    const [snippet] = searchContent(long, 'sauna').snippets;
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet).toContain('sauna');
    expect(snippet.length).toBeLessThan(long.length);
  });

  it('rejects queries under the minimum length', () => {
    expect(searchContent(doc, 'w')).toEqual({ count: 0, snippets: [] });
  });
});

describe('searchEntries', () => {
  it('tags each entry with the ordinal of its first match in the document', () => {
    const content = '# Wood\n\nStack the wood by the wood shed.\n\n- [ ] Split wood\n';
    const result = searchEntries(content, 'wood');
    expect(result.count).toBe(4);
    expect(result.entries.map((entry) => entry.ordinal)).toEqual([0, 1, 3]);
    expect(result.entries[2].text).toBe('Split wood');
  });

  it('keeps counting past the entry cap so later ordinals stay right', () => {
    const result = searchEntries('ash\nash\nash\nash', 'ash', 2);
    expect(result.count).toBe(4);
    expect(result.entries).toHaveLength(2);
  });

  it('is what searchContent renders', () => {
    const content = 'a sauna\nno match\nanother sauna';
    expect(searchContent(content, 'sauna').snippets).toEqual(
      searchEntries(content, 'sauna').entries.map((entry) => entry.text)
    );
  });
});

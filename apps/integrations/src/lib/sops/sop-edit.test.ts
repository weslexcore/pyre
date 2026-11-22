import { describe, expect, it } from 'vitest';
import { applyHunks, rebaseSopEdit, sectionHunk } from './sop-edit';

const DOC = ['# Closing', '', '- Drain the right tub', '- Wipe the benches', '- Lock up'].join(
  '\n'
);

describe('applyHunks', () => {
  it('replaces each hunk in order', () => {
    const result = applyHunks(DOC, [
      { find: '- Drain the right tub\n', replace: '' },
      { find: '- Lock up', replace: '- Set the alarm, then lock up' },
    ]);
    expect(result).toEqual({
      ok: true,
      content: '# Closing\n\n- Wipe the benches\n- Set the alarm, then lock up',
    });
  });

  it('refuses a hunk that matches nothing, naming it', () => {
    const result = applyHunks(DOC, [{ find: '- Drain the left tub', replace: '' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('edits[0]');
  });

  it('refuses a hunk that matches more than one place', () => {
    const result = applyHunks('a tub\nb tub', [{ find: 'tub', replace: 'plunge' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('more than once');
  });

  it('keeps $ patterns in the replacement literal', () => {
    const result = applyHunks('price', [{ find: 'price', replace: '$& $1 $$' }]);
    expect(result).toEqual({ ok: true, content: '$& $1 $$' });
  });
});

describe('rebaseSopEdit', () => {
  const edits = [{ find: '- Drain the right tub\n', replace: '' }];
  const proposed = applyHunks(DOC, edits);
  if (!proposed.ok) throw new Error('fixture');

  it('replays the hunks on a newer version', () => {
    const newer = `${DOC}\n- Turn off the lights`;
    expect(rebaseSopEdit({ contentMd: proposed.content, edits }, DOC, newer)).toBe(
      '# Closing\n\n- Wipe the benches\n- Lock up\n- Turn off the lights'
    );
  });

  it('gives up when the admin edited the proposal by hand', () => {
    const newer = `${DOC}\n- Turn off the lights`;
    expect(
      rebaseSopEdit({ contentMd: `${proposed.content}\n- extra`, edits }, DOC, newer)
    ).toBeNull();
  });

  it('gives up when a hunk no longer matches', () => {
    const newer = DOC.replace('- Drain the right tub\n', '');
    expect(rebaseSopEdit({ contentMd: proposed.content, edits }, DOC, newer)).toBeNull();
  });
});

describe('new sections', () => {
  const SOP = [
    '# Opening',
    '',
    '## Heaters',
    '- Switch on',
    '',
    '## Closing time',
    '- Lock up',
  ].join('\n');

  it('appends a section at the end', () => {
    const made = sectionHunk(SOP, { section: '## Late arrivals\n- Offer the next slot' });
    expect(made).toEqual({ ok: true, hunk: { append: '## Late arrivals\n- Offer the next slot' } });
    if (!made.ok) return;
    expect(applyHunks(SOP, [made.hunk])).toEqual({
      ok: true,
      content: `${SOP}\n\n## Late arrivals\n- Offer the next slot\n`,
    });
  });

  it('places a section before a heading, matching the whole line', () => {
    const doc = `${SOP}\n\n## Closing\n- Wipe down`;
    const made = sectionHunk(doc, { section: '## Towels\n- Restock', before: '## Closing' });
    if (!made.ok) throw new Error(made.error);
    const result = applyHunks(doc, [made.hunk]);
    expect(result).toEqual({
      ok: true,
      content: `${SOP}\n\n## Towels\n- Restock\n\n## Closing\n- Wipe down`,
    });
  });

  it('refuses a section without a heading, or an unknown before', () => {
    expect(sectionHunk(SOP, { section: 'just text' }).ok).toBe(false);
    expect(sectionHunk(SOP, { section: '## X', before: '## Nope' }).ok).toBe(false);
    expect(sectionHunk(SOP, { section: '## X', before: '- Lock up' }).ok).toBe(false);
  });

  it('replays an appended section on a newer version', () => {
    const edits = [{ append: '## Late arrivals\n- Offer the next slot' }];
    const proposed = applyHunks(SOP, edits);
    if (!proposed.ok) throw new Error('fixture');
    const newer = `${SOP}\n- Set the alarm`;
    expect(rebaseSopEdit({ contentMd: proposed.content, edits }, SOP, newer)).toBe(
      `${newer}\n\n## Late arrivals\n- Offer the next slot\n`
    );
  });
});

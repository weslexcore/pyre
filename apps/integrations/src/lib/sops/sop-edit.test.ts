import { describe, expect, it } from 'vitest';
import { applyHunks, rebaseSopEdit } from './sop-edit';

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

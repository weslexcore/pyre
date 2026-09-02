import { describe, expect, it } from 'vitest';
import { applyLink, type LinkTarget, linkContextAt, suggestLinks } from './link-suggest';

const TARGETS: LinkTarget[] = [
  {
    href: '/admin/sops/momence-dirty-towels',
    title: 'Dirty towels',
    detail: 'Momence',
    kind: 'sop',
  },
  { href: '/admin/sops/break-down', title: 'Break down', detail: 'Shifts', kind: 'sop' },
  { href: '/admin/sops/set-up', title: 'Set up', detail: 'Shifts', kind: 'sop' },
  {
    href: '/admin/water',
    title: 'Cold Tub Water Log',
    detail: 'Log tub test results',
    kind: 'page',
  },
  { href: '/admin/sops', title: 'SOPs', detail: 'Standard operating procedures', kind: 'page' },
];

describe('linkContextAt', () => {
  it('finds an internal href being typed after a markdown label', () => {
    const text = 'See [towels](/adm';
    expect(linkContextAt(text, text.length)).toEqual({ start: 13, query: '/adm' });
  });

  it('offers on a bare slash', () => {
    const text = '[towels](/';
    expect(linkContextAt(text, text.length)).toEqual({ start: 9, query: '/' });
  });

  it('only looks at the text before the caret', () => {
    const text = '[a](/x) and [b](/y)';
    // Caret right after "/x" — the later link is irrelevant.
    expect(linkContextAt(text, 6)).toEqual({ start: 4, query: '/x' });
    // Caret after the closing paren — no longer inside a link.
    expect(linkContextAt(text, 7)).toBeNull();
  });

  it('ignores external links, prose parens, and finished hrefs', () => {
    for (const text of [
      '[momence](https://momence.com',
      'see (/notes',
      '[done](/admin/sops/x)',
      '[label](/admin/sops/x more',
      '[label]',
      'plain text',
    ]) {
      expect(linkContextAt(text, text.length)).toBeNull();
    }
  });
});

describe('suggestLinks', () => {
  it('lists everything for a bare slash, documents first, alphabetically', () => {
    expect(suggestLinks(TARGETS, '/').map((t) => t.title)).toEqual([
      'Break down',
      'Dirty towels',
      'Set up',
      'Cold Tub Water Log',
      'SOPs',
    ]);
  });

  it('matches typed paths as a prefix', () => {
    expect(suggestLinks(TARGETS, '/admin/sops/b').map((t) => t.href)).toEqual([
      '/admin/sops/break-down',
    ]);
    expect(suggestLinks(TARGETS, '/ADMIN/W').map((t) => t.href)).toEqual(['/admin/water']);
  });

  it('matches document names typed after the slash', () => {
    expect(suggestLinks(TARGETS, '/tow').map((t) => t.href)).toEqual([
      '/admin/sops/momence-dirty-towels',
    ]);
    // Several words narrow the list; order between them doesn't matter.
    expect(suggestLinks(TARGETS, '/towels dirty').map((t) => t.href)).toEqual([
      '/admin/sops/momence-dirty-towels',
    ]);
    // A half-typed slug matches by its words too.
    expect(suggestLinks(TARGETS, '/dirty-tow').map((t) => t.href)).toEqual([
      '/admin/sops/momence-dirty-towels',
    ]);
  });

  it('ranks word-start matches above mid-word ones', () => {
    // Word starts ("Shifts", "Set up", "SOPs") first, documents before pages,
    // then the mid-word hits ("towels", "results").
    expect(suggestLinks(TARGETS, '/s').map((t) => t.title)).toEqual([
      'Break down',
      'Set up',
      'SOPs',
      'Dirty towels',
      'Cold Tub Water Log',
    ]);
  });

  it('returns nothing when nothing fits and honors the limit', () => {
    expect(suggestLinks(TARGETS, '/zzz')).toEqual([]);
    expect(suggestLinks(TARGETS, '/', 2)).toHaveLength(2);
  });
});

describe('applyLink', () => {
  it('replaces the partial href and closes the link', () => {
    const text = 'See [towels](/adm for details';
    const ctx = linkContextAt(text, 17);
    if (!ctx) throw new Error('expected a link context');
    expect(applyLink(text, ctx, 17, '/admin/sops/momence-dirty-towels')).toEqual({
      text: 'See [towels](/admin/sops/momence-dirty-towels) for details',
      caret: 'See [towels](/admin/sops/momence-dirty-towels)'.length,
    });
  });

  it('does not double a closing paren that is already there', () => {
    const text = '[towels](/)';
    const ctx = linkContextAt(text, 10);
    if (!ctx) throw new Error('expected a link context');
    expect(applyLink(text, ctx, 10, '/admin/water')).toEqual({
      text: '[towels](/admin/water)',
      caret: '[towels](/admin/water)'.length,
    });
  });
});

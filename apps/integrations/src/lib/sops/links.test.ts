import { describe, expect, it } from 'vitest';
import { linkedSopSlugs, sopSlugFromHref } from './links';

describe('sopSlugFromHref', () => {
  it('extracts the slug from a library path', () => {
    expect(sopSlugFromHref('/admin/sops/momence-dirty-towels')).toBe('momence-dirty-towels');
    expect(sopSlugFromHref('/admin/sops/break-down')).toBe('break-down');
  });

  it('strips query and hash', () => {
    expect(sopSlugFromHref('/admin/sops/break-down?q=towels')).toBe('break-down');
    expect(sopSlugFromHref('/admin/sops/break-down#plunges')).toBe('break-down');
  });

  it('leaves everything else alone', () => {
    expect(sopSlugFromHref(undefined)).toBeNull();
    expect(sopSlugFromHref('')).toBeNull();
    // External and unrelated internal links.
    expect(sopSlugFromHref('https://momence.com/host')).toBeNull();
    expect(sopSlugFromHref('/admin/water')).toBeNull();
    // Bare relative slugs are deliberately not treated as SOP links.
    expect(sopSlugFromHref('momence-dirty-towels')).toBeNull();
    // Deeper paths and the runs board aren't documents.
    expect(sopSlugFromHref('/admin/sops/a/b')).toBeNull();
    expect(sopSlugFromHref('/admin/sops/runs')).toBeNull();
    // Empty or malformed slugs.
    expect(sopSlugFromHref('/admin/sops/')).toBeNull();
    expect(sopSlugFromHref('/admin/sops/Not-A-Slug')).toBeNull();
  });
});

describe('linkedSopSlugs', () => {
  it('extracts library links in order, deduped', () => {
    const md = [
      '- [ ] [Clear towel hampers](/admin/sops/momence-dirty-towels) before close',
      '- [ ] See [the guide](https://example.com/guide) and [break down](/admin/sops/break-down)',
      '- [ ] Again [hampers](/admin/sops/momence-dirty-towels?q=x)',
    ].join('\n');
    expect(linkedSopSlugs(md)).toEqual(['momence-dirty-towels', 'break-down']);
  });

  it('ignores non-library links and plain text', () => {
    expect(linkedSopSlugs('- [ ] Wipe the glass')).toEqual([]);
    expect(linkedSopSlugs('[runs](/admin/sops/runs) [water](/admin/water)')).toEqual([]);
  });
});

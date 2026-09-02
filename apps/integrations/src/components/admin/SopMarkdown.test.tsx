// Static-markup render of the SOP markdown component, exercising the GFM
// shapes the seeded checklists rely on (headings, task lists, blockquotes).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SopMarkdown } from './SopMarkdown';

const SAMPLE = `## Large Sauna

- [ ] Uncover wood + stage wood under anteroom bench
- [x] Wipe sauna glass

> **Ongoing:** check sauna progress / add wood throughout.
`;

describe('SopMarkdown', () => {
  it('renders headings, task-list checkboxes, and blockquotes', () => {
    const html = renderToStaticMarkup(<SopMarkdown content={SAMPLE} />);
    expect(html).toContain('Large Sauna');
    expect(html).toContain('Uncover wood + stage wood under anteroom bench');
    // Task checkboxes here are reference-only — the live ones are
    // ChecklistView's — so they render disabled.
    expect(html.match(/type="checkbox"/g)?.length).toBe(2);
    expect(html).toContain('checked');
    expect(html).toContain('disabled');
    expect(html).toContain('<blockquote');
    expect(html).toContain('Ongoing:');
  });

  it('nests sub-task lists inside their parent task item', () => {
    const nested = `- [ ] Put away:
  - [ ] Lights
  - [ ] Speakers
`;
    const html = renderToStaticMarkup(<SopMarkdown content={nested} />);
    // Three checkboxes, and the sub-list rendered as a ul inside the parent li.
    expect(html.match(/type="checkbox"/g)?.length).toBe(3);
    expect(html).toMatch(/<li>[\s\S]*Put away:[\s\S]*<ul[\s\S]*Lights[\s\S]*<\/ul>\s*<\/li>/);
  });

  it('renders three-level plain bullet nesting (on-shift duty lists)', () => {
    const nested = `- Saunas
  - Ensure saunas remain at proper temperature
    - 180–190 for Finnish sauna
    - 190+ for tent
`;
    const html = renderToStaticMarkup(<SopMarkdown content={nested} />);
    // ul > li > ul > li > ul — the innermost items sit inside two ancestors.
    expect(html).toMatch(/<ul[^>]*>[\s\S]*<ul[^>]*>[\s\S]*<ul[^>]*>[\s\S]*Finnish sauna/);
    expect(html.match(/<ul/g)?.length).toBe(3);
  });

  it('wraps search matches in <mark> across element types', () => {
    const html = renderToStaticMarkup(
      <SopMarkdown
        content={'## Sauna\n\n- [ ] Wipe **sauna** glass\n\nPlain sauna text.'}
        highlight="sauna"
      />
    );
    // Heading text, bold text inside a task item, and paragraph text all mark.
    expect(html.match(/<mark/g)?.length).toBe(3);
    expect(html).toContain('<mark');
  });

  it('ignores highlight terms under the minimum length', () => {
    const html = renderToStaticMarkup(<SopMarkdown content={'sauna'} highlight="s" />);
    expect(html).not.toContain('<mark');
  });

  it('renders plain paragraphs without markdown syntax leaking through', () => {
    const html = renderToStaticMarkup(<SopMarkdown content={'Just **bold** text.'} />);
    expect(html).toContain('<strong');
    expect(html).not.toContain('**');
  });

  it('turns library links into peek buttons when onSopLink is provided', () => {
    const html = renderToStaticMarkup(
      <SopMarkdown
        content={'[Towels](/admin/sops/momence-dirty-towels) and [Momence](https://momence.com)'}
        onSopLink={() => {}}
      />
    );
    // The library link becomes a button; the external link stays an anchor.
    expect(html).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*>Towels<\/button>/);
    expect(html).toContain('<a href="https://momence.com"');
    expect(html).not.toContain('href="/admin/sops/momence-dirty-towels"');
  });

  it('opens external links in a new tab and keeps in-app links in place', () => {
    const html = renderToStaticMarkup(
      <SopMarkdown
        content={'[PubMed](https://pubmed.ncbi.nlm.nih.gov/25705824/) and [Runs](/admin/sops/runs)'}
      />
    );
    expect(html).toMatch(/<a href="https:\/\/pubmed[^>]*target="_blank"/);
    expect(html).toMatch(/<a href="\/admin\/sops\/runs"[^>]*>/);
    expect(html).not.toMatch(/<a href="\/admin\/sops\/runs"[^>]*target=/);
  });

  it('leaves library links as plain anchors without onSopLink', () => {
    const html = renderToStaticMarkup(
      <SopMarkdown content={'[Towels](/admin/sops/momence-dirty-towels)'} />
    );
    expect(html).toContain('<a href="/admin/sops/momence-dirty-towels"');
    expect(html).not.toContain('<button');
  });
});

// Static-markup render of the printable SOP view: each document carries its
// own footer in a <tfoot> (repeated per printed page), later documents start
// a new page, and task lines print as empty boxes.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { type PrintableSop, SopPrint } from './SopPrint';

const sop = (id: string, footer: string): PrintableSop => ({
  id,
  title: `Doc ${id}`,
  category: 'Opening',
  content_md:
    '## Steps\n\n- [ ] Light the fire\n- [!] Check the stove door\n\nSee [closing](/admin/sops/closing).',
  footer,
});

describe('SopPrint', () => {
  const html = renderToStaticMarkup(
    <SopPrint sops={[sop('a', 'Version 3 · by Jo'), sop('b', 'Version 9 · by Sam')]} />
  );

  it('puts each document footer in its own tfoot', () => {
    const footers = [...html.matchAll(/<tfoot>.*?<\/tfoot>/g)].map((m) => m[0]);
    expect(footers).toHaveLength(2);
    expect(footers[0]).toContain('Doc a · Version 3 · by Jo');
    expect(footers[1]).toContain('Doc b · Version 9 · by Sam');
  });

  it('starts every document after the first on a new page', () => {
    expect(html.match(/print:break-before-page/g)).toHaveLength(1);
  });

  it('prints tasks as boxes, required ones labelled, and links as plain text', () => {
    expect(html).not.toContain('<input');
    expect(html).toContain('Required');
    expect(html).not.toContain('[!]');
    expect(html).not.toContain('href=');
  });
});

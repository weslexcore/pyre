import { render } from '@react-email/components';
import { describe, expect, it } from 'vitest';
import { absolutizeLinks } from '@/lib/notifications/messages';
import type { AdminMessageEmailProps } from '../types';
import { AdminMessage } from './AdminMessage';

// The emailed copy of an admin message: the body has to survive the trip out
// of the dashboard (links that work from an inbox, markdown that reads as
// formatting rather than punctuation), and the thread link has to be there —
// it is where questions go.

const base: AdminMessageEmailProps = {
  authorName: 'Wes',
  title: 'Towels',
  bodyMd: 'Hello team.',
  messageUrl: 'https://example.test/admin/messages/abc',
};

const renderHtml = (props: Partial<AdminMessageEmailProps>) =>
  render(<AdminMessage {...base} {...props} />);

describe('AdminMessage', () => {
  it('links to the thread for questions', async () => {
    const html = await renderHtml({});
    expect(html).toContain('href="https://example.test/admin/messages/abc"');
    expect(html).toContain('Open the message');
  });

  it('draws markdown as formatting', async () => {
    const html = await renderHtml({
      bodyMd: '## Steps\n\n- Fold **in thirds**\n- Restock\n\nSee [the SOP](https://x.test/s).',
    });
    expect(html).toContain('<strong>in thirds</strong>');
    expect(html).toContain('href="https://x.test/s"');
    expect(html).not.toContain('## Steps');
    expect(html).not.toContain('- Fold');
  });

  it('formats what the dashboard formats, not just blank-line-separated blocks', async () => {
    const html = await renderHtml({
      bodyMd: [
        'Before you leave:',
        '- Wipe the benches',
        '- Lock up',
        '',
        '1. First',
        '2. Second',
        '',
        '> Quoted note',
        '',
        'Use `code` here.',
        '',
        '---',
        '',
        '| Day | Shift |',
        '| --- | --- |',
        '| Mon | AM |',
      ].join('\n'),
    });
    expect(html).toMatch(/<ul[^>]*>.*Wipe the benches/s);
    expect(html).toMatch(/<ol[^>]*>.*First/s);
    expect(html).toContain('Quoted note');
    expect(html).not.toContain('&gt; Quoted');
    expect(html).toMatch(/<code[^>]*>code<\/code>/);
    expect(html).toContain('<hr');
    expect(html).toMatch(/<td[^>]*>Mon<\/td>/);
    expect(html).not.toMatch(/[-|] (Wipe|Mon)/);
  });

  it('never links to a script', async () => {
    const html = await renderHtml({ bodyMd: '[click](javascript:alert(1))' });
    expect(html).not.toContain('javascript:');
  });
});

describe('absolutizeLinks', () => {
  it('makes dashboard paths absolute and leaves full URLs alone', () => {
    expect(
      absolutizeLinks('[SOP](/admin/sops/x) and [site](https://a.test)', 'https://o.test')
    ).toBe('[SOP](https://o.test/admin/sops/x) and [site](https://a.test)');
  });
});

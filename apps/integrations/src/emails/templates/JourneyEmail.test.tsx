import { render } from '@react-email/components';
import { describe, expect, it } from 'vitest';
import type { JourneyEmailProps } from '../types';
import { JourneyEmail } from './JourneyEmail';

// Dashboard-written emails go straight from an admin's text box to customers,
// so the renderer is the only thing standing between a typo and an inbox:
// formatting must come out as formatting, our links must carry tracking, and
// anything unsafe must not render at all.

const base: JourneyEmailProps = {
  firstName: 'Ana',
  subject: 'Hi',
  preview: 'Preview line',
  background: 'trees',
  campaign: 'intro-to-membership',
  unsubscribeUrl: 'https://example.com/unsub',
  blocks: [],
};

const html = (blocks: JourneyEmailProps['blocks']) =>
  render(<JourneyEmail {...base} blocks={blocks} />);

describe('JourneyEmail', () => {
  it('renders bold text and splits paragraphs on blank lines', async () => {
    const out = await html([{ type: 'paragraph', text: 'One **two**\n\nThree' }]);
    expect(out).toContain('<strong>two</strong>');
    expect(out).toMatch(/One[\s\S]*<\/p>[\s\S]*Three/);
  });

  it('tags our own and Momence links with UTM but leaves third-party links alone', async () => {
    const out = await html([
      { type: 'button', label: 'See memberships', url: 'https://pyresauna.com/#memberships' },
      { type: 'paragraph', text: 'Or [review us](https://g.page/r/abc/review)' },
      { type: 'button', label: 'Buy', url: 'https://momence.com/m/630916' },
    ]);
    expect(out).toContain('utm_campaign=intro-to-membership');
    expect(out).toContain('utm_content=see-memberships');
    expect(out).toContain('href="https://g.page/r/abc/review"');
    expect(out).toContain('https://momence.com/m/630916?utm_source=lifecycle');
  });

  it('drops buttons and images with unsafe URLs', async () => {
    const out = await html([
      { type: 'button', label: 'Bad', url: 'javascript:alert(1)' },
      { type: 'image', src: 'data:image/png;base64,xx', alt: 'x' },
    ]);
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('data:image');
  });

  it('keeps the unsubscribe link in the footer', async () => {
    expect(await html([])).toContain('https://example.com/unsub');
  });
});

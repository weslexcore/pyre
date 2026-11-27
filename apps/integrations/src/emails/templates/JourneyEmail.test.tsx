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
  render(<JourneyEmail {...base} stepKey="prorate-offer" blocks={blocks} />);

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
    expect(out).toContain('utm_content=prorate-offer-see-memberships');
    expect(out).toContain('utm_source=lifecycle');
    expect(out).toContain('utm_medium=email');
    expect(out).toContain('href="https://g.page/r/abc/review"');
    expect(out).toContain('https://momence.com/m/630916?utm_source=lifecycle');
  });

  it('keeps tags already on a link, such as one built in the Campaigns tool', async () => {
    const out = await html([
      {
        type: 'button',
        label: 'Rest Fest',
        url: 'https://pyresauna.com/events?utm_campaign=rest-fest-2026&utm_source=newsletter',
      },
    ]);
    expect(out).toContain('utm_campaign=rest-fest-2026');
    expect(out).toContain('utm_source=newsletter');
    expect(out).not.toContain('utm_campaign=intro-to-membership');
    expect(out).toContain('utm_medium=email');
  });

  it('turns a pasted URL into a tagged link named after its page', async () => {
    const out = await html([{ type: 'paragraph', text: 'Book at https://pyresauna.com/events.' }]);
    expect(out).toContain('href="https://pyresauna.com/events?utm_source=lifecycle');
    expect(out).toContain('utm_content=prorate-offer-events');
    expect(out).toMatch(/<\/a>\./);
  });

  it('draws buttons in the chosen color and style', async () => {
    const solid = await html([
      { type: 'button', label: 'Go', url: 'https://pyresauna.com/', color: 'sky', style: 'filled' },
    ]);
    expect(solid).toMatch(/background-color:#3991b7/);

    const outline = await html([
      {
        type: 'button',
        label: 'Go',
        url: 'https://pyresauna.com/',
        color: 'gold',
        style: 'outline',
      },
    ]);
    expect(outline).toMatch(/border:2px solid #dbb155/);

    const link = await html([
      {
        type: 'button',
        label: 'Read more',
        url: 'https://pyresauna.com/',
        color: 'sage',
        style: 'link',
      },
    ]);
    expect(link).toMatch(/color:#839770/);
    expect(link).toContain('text-decoration:underline');
  });

  it('draws a button saved before colors existed as the solid red default', async () => {
    const out = await html([{ type: 'button', label: 'Go', url: 'https://pyresauna.com/' }]);
    expect(out).toMatch(/background-color:#d15232/);
  });

  it('draws dividers in the chosen color, and sky blue when none was chosen', async () => {
    const hrStyles = (out: string) =>
      [...out.matchAll(/<hr[^>]*style="([^"]*)"/g)].map((m) => m[1]);
    const out = await html([{ type: 'divider', color: 'gold' }, { type: 'divider' }]);
    const [gold, plain] = hrStyles(out);
    expect(gold).toContain('#dbb155');
    expect(plain).toContain('#3991b7');
  });

  it('lines up headings and text as each block asks, in a journey too', async () => {
    const out = await html([
      { type: 'heading', text: 'Centered', align: 'center' },
      { type: 'paragraph', text: 'Justified', align: 'justify' },
    ]);
    expect(out).toMatch(/<p[^>]*style="[^"]*text-align:center[^"]*"[^>]*>Centered/);
    expect(out).toMatch(/<p[^>]*style="[^"]*text-align:justify[^"]*"[^>]*>Justified/);
  });

  it("shows the step's own logo, no logo, or Pyre's when none was chosen", async () => {
    const own = 'https://example.supabase.co/storage/v1/object/public/email-media/2026-11/b.png';
    const withLogo = (logo?: string) => render(<JourneyEmail {...base} logo={logo} />);
    expect(await withLogo()).toContain('logo-header-creme.png');
    const custom = await withLogo(own);
    expect(custom).toContain(own);
    expect(custom).not.toContain('logo-header-creme.png');
    expect(await withLogo('none')).not.toContain('alt="Pyre"');
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

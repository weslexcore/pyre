import { describe, expect, it } from 'vitest';
import type { BlockContent } from '@/lib/email/journeys/schema';
import { newsletterProblems, toTemplateContent, UNSUBSCRIBE_PLACEHOLDER } from './content';
import { NewsletterContentError, personalize, renderNewsletter } from './render';

const content = (over: Partial<BlockContent> = {}): BlockContent => ({
  type: 'blocks',
  subject: 'December at Pyre',
  preview: 'What is on this month',
  background: 'clouds',
  blocks: [
    { type: 'heading', text: 'Hi {{firstName|there}}' },
    {
      type: 'paragraph',
      text: 'New **evening** sessions, [see them](https://pyresauna.com/events).',
    },
    {
      type: 'button',
      label: 'Book now',
      url: 'https://momence.com/m/1',
      color: 'red',
      style: 'filled',
      fullWidth: false,
    },
  ],
  ...over,
});

describe('newsletterProblems', () => {
  it('accepts firstName with a fallback, in the body and the subject', () => {
    expect(newsletterProblems(content())).toEqual([]);
    expect(newsletterProblems(content({ subject: '{{firstName|Friend}}, December' }))).toEqual([]);
  });

  it('refuses fields only a journey can fill', () => {
    const problems = newsletterProblems(
      content({ blocks: [{ type: 'paragraph', text: 'You have {{creditsLeft|some}} credits' }] })
    );
    expect(problems.join(' ')).toMatch(/only works in journeys/);
  });

  it('wants a fallback for the first name', () => {
    const problems = newsletterProblems(
      content({ blocks: [{ type: 'heading', text: 'Hi {{firstName}}' }] })
    );
    expect(problems.join(' ')).toMatch(/needs a fallback/);
  });

  it('keeps fields out of link and image addresses', () => {
    const problems = newsletterProblems(
      content({
        blocks: [
          {
            type: 'button',
            label: 'Go',
            url: 'https://pyresauna.com/?n={{firstName|x}}',
            color: 'red',
            style: 'filled',
            fullWidth: false,
          },
        ],
      })
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("can't go in");
  });

  it('refuses an empty newsletter, a missing subject and unknown fields', () => {
    expect(newsletterProblems(content({ blocks: [] }))).toEqual([
      'The newsletter has no content yet.',
    ]);
    expect(newsletterProblems(content({ subject: ' ' }))).toEqual([
      'The newsletter needs a subject.',
    ]);
    expect(
      newsletterProblems(content({ blocks: [{ type: 'paragraph', text: '{{nickname|x}}' }] }))[0]
    ).toMatch(/not a merge field/);
  });
});

describe('toTemplateContent', () => {
  it('turns merge fields into placeholders, subject included', () => {
    const out = toTemplateContent(content({ subject: '{{firstName|Friend}}, hi' }));
    expect(out.blocks[0]).toEqual({ type: 'heading', text: 'Hi {{{first_name|there}}}' });
    expect(out.subject).toBe('{{{first_name|Friend}}}, hi');
  });
});

const recipient = { firstName: 'Ana', unsubscribeUrl: 'https://example.com/unsub?token=a.b&x=1' };

describe('renderNewsletter', () => {
  it('lines up headings and text as each block asks', async () => {
    const out = await renderNewsletter(
      content({
        blocks: [
          { type: 'heading', text: 'Centered heading', align: 'center' },
          { type: 'paragraph', text: 'Right text\n\n## Right subheading', align: 'right' },
          { type: 'paragraph', text: 'Justified text', align: 'justify' },
          { type: 'paragraph', text: 'Plain text' },
        ],
      }),
      'newsletter-2026-12'
    );
    const styleOf = (inner: string) =>
      out.html.match(new RegExp(`<p[^>]*style="([^"]*)"[^>]*>${inner}`))?.[1] ?? '';
    expect(styleOf('Centered heading')).toContain('text-align:center');
    expect(styleOf('Right text')).toContain('text-align:right');
    expect(styleOf('Right subheading')).toContain('text-align:right');
    expect(styleOf('Justified text')).toContain('text-align:justify');
    expect(styleOf('Plain text')).not.toContain('text-align');
  });

  it("shows Pyre's logo unless told otherwise", async () => {
    const pyre = await renderNewsletter(content(), 'newsletter-2026-12');
    expect(pyre.html).toContain('logo-header-creme.png');

    const own = 'https://example.supabase.co/storage/v1/object/public/email-media/2026-11/a.png';
    const custom = await renderNewsletter(content({ logo: own }), 'newsletter-2026-12');
    expect(custom.html).toContain(own);
    expect(custom.html).not.toContain('logo-header-creme.png');

    const none = await renderNewsletter(content({ logo: 'none' }), 'newsletter-2026-12');
    expect(none.html).not.toContain('logo-header-creme.png');
    expect(none.html).not.toContain('alt="Pyre"');
  });

  it('renders once with placeholders, the address and newsletter UTMs', async () => {
    const out = await renderNewsletter(content(), 'newsletter-2026-12');
    expect(out.html).toContain('Hi {{{first_name|there}}}');
    expect(out.html).toContain(`href="${UNSUBSCRIBE_PLACEHOLDER}"`);
    expect(out.text).toContain(UNSUBSCRIBE_PLACEHOLDER);
    expect(out.html).toContain('1000 Westover Hills Blvd.');
    expect(out.html).toContain('utm_source=newsletter');
    expect(out.html).toContain('utm_campaign=newsletter-2026-12');
    expect(out.html).not.toContain('utm_source=lifecycle');
    expect(out.html).toContain('<strong>evening</strong>');
    expect(out.subject).toBe('December at Pyre');
  });

  it('refuses content with problems', async () => {
    await expect(
      renderNewsletter(content({ blocks: [] }), 'newsletter-2026-12')
    ).rejects.toBeInstanceOf(NewsletterContentError);
  });
});

describe('personalize', () => {
  it('fills in the name and that person’s unsubscribe link', async () => {
    const template = await renderNewsletter(
      content({ subject: '{{firstName|Friend}}, December' }),
      'newsletter-2026-12'
    );
    const copy = personalize(template, recipient);
    expect(copy.subject).toBe('Ana, December');
    expect(copy.html).toContain('Hi Ana');
    expect(copy.html).toContain('href="https://example.com/unsub?token=a.b&amp;x=1"');
    expect(copy.text).toContain('https://example.com/unsub?token=a.b&x=1');
    expect(copy.html).not.toContain('{{{');
    expect(copy.text).not.toContain('{{{');
  });

  it('uses the fallback without a name, and escapes a name for HTML', async () => {
    const template = await renderNewsletter(
      content({
        blocks: [
          { type: 'paragraph', text: '{{firstName|friend}} and {{firstName|pal}}, welcome back.' },
        ],
      }),
      'newsletter-2026-12'
    );
    expect(personalize(template, { unsubscribeUrl: 'https://u' }).html).toContain(
      'friend and pal, welcome back.'
    );
    const html = personalize(template, {
      firstName: ' <b>Jo</b>\n ',
      unsubscribeUrl: 'https://u',
    }).html;
    expect(html).toContain('&lt;b&gt;Jo&lt;/b&gt; and &lt;b&gt;Jo&lt;/b&gt;');
    expect(html).not.toContain('<b>Jo</b>');
  });
});

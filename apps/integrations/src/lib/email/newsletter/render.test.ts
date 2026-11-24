import { describe, expect, it } from 'vitest';
import type { BlockContent } from '@/lib/email/journeys/schema';
import { newsletterProblems, RESEND_UNSUBSCRIBE_PLACEHOLDER, toBroadcastContent } from './content';
import { NewsletterContentError, renderNewsletter } from './render';

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
  it('accepts firstName with a fallback in the body', () => {
    expect(newsletterProblems(content())).toEqual([]);
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

  it('keeps fields out of the subject, preview and link addresses', () => {
    const problems = newsletterProblems(
      content({
        subject: 'Hi {{firstName|there}}',
        preview: '{{firstName|friend}}, look',
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
    expect(problems).toHaveLength(3);
    expect(problems.every((p) => p.includes("can't go in"))).toBe(true);
  });

  it('refuses an empty newsletter and unknown fields', () => {
    expect(newsletterProblems(content({ blocks: [] }))).toEqual([
      'The newsletter has no content yet.',
    ]);
    expect(
      newsletterProblems(content({ blocks: [{ type: 'paragraph', text: '{{nickname|x}}' }] }))[0]
    ).toMatch(/not a merge field/);
  });
});

describe('toBroadcastContent', () => {
  it('turns merge fields into Resend contact properties', () => {
    const out = toBroadcastContent(content());
    expect(out.blocks[0]).toEqual({ type: 'heading', text: 'Hi {{{contact.first_name|there}}}' });
  });
});

describe('renderNewsletter', () => {
  it('renders a broadcast with Resend placeholders, the address and newsletter UTMs', async () => {
    const out = await renderNewsletter(content(), 'newsletter-2026-12', { kind: 'broadcast' });
    expect(out.html).toContain('Hi {{{contact.first_name|there}}}');
    expect(out.html).toContain(`href="${RESEND_UNSUBSCRIBE_PLACEHOLDER}"`);
    expect(out.text).toContain(RESEND_UNSUBSCRIBE_PLACEHOLDER);
    expect(out.html).toContain('1000 Westover Hills Blvd.');
    expect(out.html).toContain('utm_source=newsletter');
    expect(out.html).toContain('utm_campaign=newsletter-2026-12');
    expect(out.html).not.toContain('utm_source=lifecycle');
    expect(out.html).toContain('<strong>evening</strong>');
    expect(out.subject).toBe('December at Pyre');
  });

  it('keeps the placeholder intact through Markdown', async () => {
    const out = await renderNewsletter(
      content({
        blocks: [
          {
            type: 'paragraph',
            text: '{{firstName|friend}} and {{firstName|pal}}, welcome back.',
          },
        ],
      }),
      'newsletter-2026-12',
      { kind: 'broadcast' }
    );
    expect(out.html).toContain(
      '{{{contact.first_name|friend}}} and {{{contact.first_name|pal}}}, welcome back.'
    );
  });

  it('renders one person’s copy for previews and test sends', async () => {
    const out = await renderNewsletter(content(), 'newsletter-2026-12', {
      kind: 'personal',
      firstName: 'Ana',
      unsubscribeUrl: 'https://example.com/unsub',
    });
    expect(out.html).toContain('Hi Ana');
    expect(out.html).toContain('https://example.com/unsub');
    expect(out.html).not.toContain('{{{');

    const nameless = await renderNewsletter(content(), 'newsletter-2026-12', {
      kind: 'personal',
      unsubscribeUrl: 'https://example.com/unsub',
    });
    expect(nameless.html).toContain('Hi there');
  });

  it('refuses content with problems', async () => {
    await expect(
      renderNewsletter(content({ blocks: [] }), 'newsletter-2026-12', { kind: 'broadcast' })
    ).rejects.toBeInstanceOf(NewsletterContentError);
  });
});

import { describe, expect, it } from 'vitest';
import {
  batchIdempotencyKey,
  buildBatch,
  matchBatchResults,
  NEWSLETTER_TEMPLATE,
  newsletterSendKey,
} from './batch';

const template = {
  subject: '{{{first_name|Friend}}}, December',
  html: '<p>Hi {{{first_name|there}}}</p><a href="{{{UNSUBSCRIBE_URL}}}">Unsubscribe</a>',
  text: 'Hi {{{first_name|there}}}\nUnsubscribe: {{{UNSUBSCRIBE_URL}}}',
};

describe('buildBatch', () => {
  it('gives each person their own copy, headers and tags', () => {
    const [ana, nameless] = buildBatch(
      template,
      [
        { email: 'ana@example.com', firstName: 'Ana', unsubscribeUrl: 'https://u/ana' },
        { email: 'b@example.com', firstName: null, unsubscribeUrl: 'https://u/b' },
      ],
      { from: 'Pyre <news@pyresauna.com>', campaign: 'newsletter-2026-12' }
    );
    expect(ana.payload).toMatchObject({
      from: 'Pyre <news@pyresauna.com>',
      to: 'ana@example.com',
      subject: 'Ana, December',
      html: '<p>Hi Ana</p><a href="https://u/ana">Unsubscribe</a>',
      text: 'Hi Ana\nUnsubscribe: https://u/ana',
      headers: {
        'List-Unsubscribe': '<https://u/ana>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      tags: [
        { name: 'template', value: NEWSLETTER_TEMPLATE },
        { name: 'kind', value: 'marketing' },
        { name: 'campaign', value: 'newsletter-2026-12' },
      ],
    });
    expect(nameless.subject).toBe('Friend, December');
    expect(nameless.payload.html).toContain('Hi there');
  });
});

describe('keys', () => {
  it('claims one copy per person per issue', () => {
    expect(newsletterSendKey('n1', 'A@Example.com')).toBe('newsletter:n1:a@example.com');
  });

  it('gives the same batch the same idempotency key, and another batch another', () => {
    const a = batchIdempotencyKey('n1', ['k1', 'k2']);
    expect(batchIdempotencyKey('n1', ['k1', 'k2'])).toBe(a);
    expect(batchIdempotencyKey('n1', ['k1', 'k3'])).not.toBe(a);
    expect(a.length).toBeLessThanOrEqual(256);
  });
});

describe('matchBatchResults', () => {
  it('lines ids up with the accepted copies around the refused ones', () => {
    expect(
      matchBatchResults(3, [{ id: 'e1' }, { id: 'e3' }], [{ index: 1, message: 'bad address' }])
    ).toEqual([{ id: 'e1' }, { error: 'bad address' }, { id: 'e3' }]);
  });

  it('leaves ids off when the counts do not add up', () => {
    expect(matchBatchResults(2, [{ id: 'e1' }], [])).toEqual([{}, {}]);
  });
});

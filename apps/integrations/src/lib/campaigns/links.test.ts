import { slugifyCampaign as storeSlugify } from '@pyre/webhook-core';
import { describe, expect, it } from 'vitest';
import {
  applyUtm,
  buildPlacementLink,
  parseExternalUrl,
  qrFilename,
  resolveDestination,
} from './links';
import { placementByKey } from './placements';
import { slugifyCampaign, slugifyPart } from './slug';

const ORIGIN = 'https://pyresauna.com';

function must(key: string) {
  const p = placementByKey(key);
  if (!p) throw new Error(`missing placement ${key}`);
  return p;
}

describe('slug parity', () => {
  it('matches the store for names the team actually types', () => {
    for (const name of [
      'Rest Fest 2026',
      '  Summer Launch!! ',
      'BFT 15% off',
      'instagram-bio-links',
      'Émigré nights',
      '---',
    ]) {
      expect(slugifyCampaign(name)).toBe(storeSlugify(name));
    }
  });

  it('keeps underscores in parts but not other punctuation', () => {
    expect(slugifyPart('paid_social')).toBe('paid_social');
    expect(slugifyPart(' Footer Link! ')).toBe('footer-link');
    expect(slugifyPart('v2')).toBe('v2');
  });
});

describe('resolveDestination', () => {
  it('maps site destinations to landing-site URLs', () => {
    expect(resolveDestination(ORIGIN, 'home', '')).toEqual({
      ok: true,
      url: 'https://pyresauna.com/',
    });
    expect(resolveDestination(ORIGIN, 'events', '')).toEqual({
      ok: true,
      url: 'https://pyresauna.com/events',
    });
    expect(resolveDestination(ORIGIN, 'linktree', '')).toEqual({
      ok: true,
      url: 'https://pyresauna.com/hi',
    });
    expect(resolveDestination(ORIGIN, 'event', 'abc 1')).toEqual({
      ok: true,
      url: 'https://pyresauna.com/events/abc%201',
    });
    expect(resolveDestination(ORIGIN, 'blog', 'why-sauna')).toEqual({
      ok: true,
      url: 'https://pyresauna.com/blog/why-sauna',
    });
  });

  it('requires a value for event and blog', () => {
    expect(resolveDestination(ORIGIN, 'event', ' ').ok).toBe(false);
    expect(resolveDestination(ORIGIN, 'blog', '').ok).toBe(false);
  });

  it('accepts external URLs and assumes https', () => {
    expect(resolveDestination(ORIGIN, 'custom', 'eventbrite.com/e/123?aff=x')).toEqual({
      ok: true,
      url: 'https://eventbrite.com/e/123?aff=x',
    });
  });

  it('rejects non-http schemes and dotless hosts', () => {
    expect(parseExternalUrl('mailto:hi@example.com')).toBeNull();
    expect(parseExternalUrl('https://foo')).toBeNull();
    expect(parseExternalUrl('')).toBeNull();
    expect(resolveDestination(ORIGIN, 'custom', 'javascript:alert(1)').ok).toBe(false);
  });

  it('rejects an unset kind', () => {
    expect(resolveDestination(ORIGIN, '', '').ok).toBe(false);
  });
});

describe('applyUtm', () => {
  it('slugifies the campaign and skips empty fields', () => {
    const url = applyUtm(new URL('https://pyresauna.com/events?event=1'), {
      source: 'instagram',
      medium: 'social',
      campaign: 'Rest Fest 2026',
      content: '',
    });
    expect(url).toBe(
      'https://pyresauna.com/events?event=1&utm_source=instagram&utm_medium=social&utm_campaign=rest-fest-2026'
    );
  });
});

describe('buildPlacementLink', () => {
  it('links an event campaign to the event page, not the modal', () => {
    const dest = resolveDestination(ORIGIN, 'event', '12345');
    expect(dest.ok && dest.url).toBe('https://pyresauna.com/events/12345');
    const built = buildPlacementLink({
      destinationUrl: dest.ok ? dest.url : '',
      slug: 'rest-fest-2026',
      placement: must('sms-blast'),
      variant: '',
    });
    expect(built.url.startsWith('https://pyresauna.com/events/12345?utm_source=sms')).toBe(true);
  });

  it('builds the Instagram bio link from the catalog values', () => {
    const built = buildPlacementLink({
      destinationUrl: 'https://pyresauna.com/',
      slug: 'rest-fest-2026',
      placement: must('instagram-bio'),
      variant: '',
    });
    expect(built).toEqual({
      url: 'https://pyresauna.com/?utm_source=instagram&utm_medium=social&utm_campaign=rest-fest-2026&utm_content=bio-link',
      source: 'instagram',
      medium: 'social',
      content: 'bio-link',
      term: '',
    });
  });

  it('suffixes the variant onto utm_content', () => {
    const built = buildPlacementLink({
      destinationUrl: 'https://pyresauna.com/',
      slug: 'x',
      placement: must('email-newsletter'),
      variant: 'Footer',
    });
    expect(built.content).toBe('cta-footer');
    expect(new URL(built.url).searchParams.get('utm_content')).toBe('cta-footer');
  });

  it('preserves an existing query string on the destination', () => {
    const built = buildPlacementLink({
      destinationUrl: 'https://eventbrite.com/e/1?aff=pyre',
      slug: 'x',
      placement: must('sms-blast'),
      variant: '',
    });
    const params = new URL(built.url).searchParams;
    expect(params.get('aff')).toBe('pyre');
    expect(params.get('utm_medium')).toBe('sms');
  });

  it('slugifies the partner name into utm_source', () => {
    const built = buildPlacementLink({
      destinationUrl: 'https://pyresauna.com/',
      slug: 'x',
      placement: must('partner-share'),
      variant: '',
      sourceOverride: 'Body Fit Training',
    });
    expect(built.source).toBe('body-fit-training');
    expect(built.medium).toBe('partner');
  });

  it('slugifies custom values and keeps the term', () => {
    const built = buildPlacementLink({
      destinationUrl: 'https://pyresauna.com/',
      slug: 'x',
      placement: must('custom'),
      variant: '',
      custom: {
        source: 'Local Paper',
        medium: 'Print Ad',
        content: 'Back Page',
        term: 'Sauna Near Me',
      },
    });
    expect(built).toMatchObject({
      source: 'local-paper',
      medium: 'print-ad',
      content: 'back-page',
      term: 'sauna-near-me',
    });
    expect(new URL(built.url).searchParams.get('utm_term')).toBe('sauna-near-me');
  });
});

describe('qrFilename', () => {
  it('leads with the campaign and drops empties', () => {
    expect(qrFilename(['rest-fest-2026', 'qr-print', undefined, ''])).toBe(
      'pyre-qr-rest-fest-2026-qr-print'
    );
    expect(qrFilename([])).toBe('pyre-qr');
  });
});

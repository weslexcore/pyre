import { describe, expect, it } from 'vitest';
import { describeLink } from './describe';

const base = { placementKey: '', variant: '', source: '', medium: '', content: '' };

describe('describeLink', () => {
  it('names a standard placement', () => {
    expect(describeLink({ ...base, placementKey: 'instagram-bio', source: 'instagram' })).toBe(
      'Instagram bio'
    );
  });

  it('adds the partner to partner share', () => {
    expect(
      describeLink({ ...base, placementKey: 'partner-share', source: 'body-fit-training' })
    ).toBe('Partner share: body-fit-training');
  });

  it('spells out custom links by their values', () => {
    expect(
      describeLink({
        ...base,
        placementKey: 'custom',
        source: 'local-paper',
        medium: 'print-ad',
        content: 'back-page',
      })
    ).toBe('Custom: local-paper / print-ad / back-page');
    expect(describeLink({ ...base, placementKey: 'custom', source: 'x', medium: 'y' })).toBe(
      'Custom: x / y'
    );
  });

  it('treats legacy rows with no placement the same as custom', () => {
    expect(describeLink({ ...base, source: 'sms', medium: 'sms' })).toBe('Custom: sms / sms');
    expect(describeLink(base)).toBe('Custom');
  });

  it('appends the variant', () => {
    expect(
      describeLink({
        ...base,
        placementKey: 'email-newsletter',
        source: 'newsletter',
        variant: 'footer',
      })
    ).toBe('Email newsletter (footer)');
  });
});

import { isValidAlias as storeIsValidAlias } from '@pyre/webhook-core';
import { describe, expect, it } from 'vitest';
import { aliasError, destinationKey, isValidAlias, normalizeAlias } from './alias';

describe('isValidAlias', () => {
  it('matches the store rule exactly', () => {
    const samples = [
      'summer-sale',
      'Summer_Sale2',
      'a',
      'x'.repeat(64),
      'x'.repeat(65),
      '',
      'has space',
      'slash/inside',
      'dot.inside',
      'ünïcode',
      'question?',
    ];
    for (const sample of samples) {
      expect(isValidAlias(sample), sample).toBe(storeIsValidAlias(sample));
    }
  });
});

describe('normalizeAlias', () => {
  it('lowercases, trims, and folds spaces to dashes', () => {
    expect(normalizeAlias('  Summer Sale ')).toBe('summer-sale');
    expect(normalizeAlias('Cold   Plunge')).toBe('cold-plunge');
    expect(normalizeAlias('ok_name-1')).toBe('ok_name-1');
  });

  it('caps at the store limit', () => {
    expect(normalizeAlias('x'.repeat(100))).toHaveLength(64);
  });
});

describe('aliasError', () => {
  it('is quiet for an empty name (an auto code is minted) and a good one', () => {
    expect(aliasError('')).toBeNull();
    expect(aliasError('summer-sale')).toBeNull();
  });

  it('names the rule when a character is not allowed', () => {
    expect(aliasError('summer/sale')).toMatch(/letters, numbers/);
    expect(aliasError('sale.2026')).toMatch(/letters, numbers/);
  });
});

describe('destinationKey', () => {
  it('treats www, case, trailing slash, and fragment as the same place', () => {
    const key = destinationKey('https://pyresauna.com/events');
    expect(destinationKey('https://WWW.pyresauna.com/events/')).toBe(key);
    expect(destinationKey('http://pyresauna.com/events#top')).toBe(key);
  });

  it('ignores utm tags but keeps other query params', () => {
    const plain = destinationKey('https://pyresauna.com/events');
    expect(
      destinationKey('https://pyresauna.com/events?utm_source=ig&utm_medium=bio&UTM_campaign=x')
    ).toBe(plain);
    expect(destinationKey('https://pyresauna.com/events?event=abc')).not.toBe(plain);
    expect(destinationKey('https://pyresauna.com/events?b=2&a=1')).toBe(
      destinationKey('https://pyresauna.com/events?a=1&b=2')
    );
  });

  it('is null for anything that is not an http(s) URL', () => {
    expect(destinationKey('not a url')).toBeNull();
    expect(destinationKey('mailto:hi@pyresauna.com')).toBeNull();
    expect(destinationKey('')).toBeNull();
  });
});

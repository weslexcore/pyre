import { describe, expect, it } from 'vitest';
import {
  isSettingKey,
  membershipIdFrom,
  parseEnvValue,
  parseSettingValue,
  SETTINGS,
} from './registry';

describe('parseSettingValue', () => {
  it('takes only true or false for a switch', () => {
    expect(parseSettingValue('suggestions.auto', true)).toEqual({ ok: true, value: true });
    expect(parseSettingValue('suggestions.auto', 'on').ok).toBe(false);
  });

  it('keeps choices in the options’ order, without repeats', () => {
    expect(parseSettingValue('suggestions.autoSignals', ['update', 'action', 'update'])).toEqual({
      ok: true,
      value: ['action', 'update'],
    });
  });

  it('refuses unknown choices and too few', () => {
    expect(parseSettingValue('suggestions.autoSignals', ['action', 'gossip']).ok).toBe(false);
    expect(parseSettingValue('suggestions.autoSignals', []).ok).toBe(false);
    expect(parseSettingValue('suggestions.autoSignals', 'action').ok).toBe(false);
  });
});

describe('parseEnvValue', () => {
  it('reads the usual spellings of on and off', () => {
    expect(parseEnvValue('suggestions.auto', 'on')).toBe(true);
    expect(parseEnvValue('suggestions.auto', ' TRUE ')).toBe(true);
    expect(parseEnvValue('suggestions.auto', 'off')).toBe(false);
    expect(parseEnvValue('suggestions.auto', '0')).toBe(false);
  });

  it('treats unset or unreadable as not set', () => {
    expect(parseEnvValue('suggestions.auto', undefined)).toBeUndefined();
    expect(parseEnvValue('suggestions.auto', '')).toBeUndefined();
    expect(parseEnvValue('suggestions.auto', 'maybe')).toBeUndefined();
  });

  it('reads a comma list for choices', () => {
    expect(parseEnvValue('suggestions.autoSignals', 'update, action')).toEqual([
      'action',
      'update',
    ]);
  });
});

describe('the due-days grid', () => {
  it('saves a grid and has no environment spelling', () => {
    const grid = SETTINGS['suggestions.dueDays'].default;
    expect(parseSettingValue('suggestions.dueDays', grid)).toEqual({ ok: true, value: grid });
    expect(parseSettingValue('suggestions.dueDays', true).ok).toBe(false);
    expect(parseEnvValue('suggestions.dueDays', '3')).toBeUndefined();
  });
});

describe('intro offer products', () => {
  it('saves Momence ids without repeats, in the order given', () => {
    expect(parseSettingValue('momence.introOfferIds', [966626, 630918, 966626])).toEqual({
      ok: true,
      value: [966626, 630918],
    });
    expect(parseSettingValue('momence.introOfferIds', [])).toEqual({ ok: true, value: [] });
  });

  it('refuses anything that is not a whole positive id', () => {
    expect(parseSettingValue('momence.introOfferIds', ['966626']).ok).toBe(false);
    expect(parseSettingValue('momence.introOfferIds', [0]).ok).toBe(false);
    expect(parseSettingValue('momence.introOfferIds', [12.5]).ok).toBe(false);
    expect(parseSettingValue('momence.introOfferIds', '966626').ok).toBe(false);
  });

  it('takes an id or a Momence checkout link', () => {
    expect(membershipIdFrom(' 966626 ')).toBe(966626);
    expect(membershipIdFrom('https://momence.com/m/966626')).toBe(966626);
    expect(membershipIdFrom('https://momence.com/Pyre/membership/Unlimited-Intro/966626?x=1')).toBe(
      966626
    );
    expect(membershipIdFrom('momence.com/m/')).toBeNull();
    expect(membershipIdFrom('intro')).toBeNull();
    expect(membershipIdFrom('0')).toBeNull();
  });

  it('reads the env var’s comma list, skipping what is not an id', () => {
    expect(parseEnvValue('momence.introOfferIds', '630918, 966626')).toEqual([630918, 966626]);
    expect(parseEnvValue('momence.introOfferIds', '630918,,abc')).toEqual([630918]);
    expect(parseEnvValue('momence.introOfferIds', '')).toBeUndefined();
  });
});

describe('the registry', () => {
  it('keeps every default valid', () => {
    for (const [key, def] of Object.entries(SETTINGS)) {
      if (!isSettingKey(key)) throw new Error(key);
      expect(parseSettingValue(key, def.default).ok, key).toBe(true);
    }
  });

  it('keeps keys to the shape the table allows', () => {
    for (const key of Object.keys(SETTINGS)) {
      expect(key).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-zA-Z0-9_]*)+$/);
    }
  });
});

describe('hidden tools setting', () => {
  it('defaults to all tools visible and permits hiding registered tools', () => {
    expect(SETTINGS['navigation.hiddenTools'].default).toEqual([]);
    expect(parseSettingValue('navigation.hiddenTools', ['/admin/water', '/admin/water'])).toEqual({
      ok: true,
      value: ['/admin/water'],
    });
    expect(parseSettingValue('navigation.hiddenTools', []).ok).toBe(true);
  });

  it.each([
    '/admin/settings',
    '/admin',
    '/admin/messages',
    '/admin/notifications',
    '/admin/unknown',
  ])('refuses to hide %s', (href) => {
    expect(parseSettingValue('navigation.hiddenTools', [href]).ok).toBe(false);
  });
});

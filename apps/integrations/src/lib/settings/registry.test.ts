import { describe, expect, it } from 'vitest';
import { isSettingKey, parseEnvValue, parseSettingValue, SETTINGS } from './registry';

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

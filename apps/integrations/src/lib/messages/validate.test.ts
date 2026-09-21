import { describe, expect, it } from 'vitest';
import {
  BODY_MAX,
  normalizeBody,
  normalizeTitle,
  parseAudience,
  REPLY_MAX,
  TITLE_MAX,
} from './validate';

describe('normalizeTitle / normalizeBody', () => {
  it('trims and enforces the limits', () => {
    expect(normalizeTitle('  Hello  ')).toBe('Hello');
    expect(normalizeTitle('   ')).toBe('');
    expect(normalizeTitle('x'.repeat(TITLE_MAX + 1))).toBe('');
    expect(normalizeTitle(42)).toBe('');
  });

  it('keeps inner indentation but drops the blank edges', () => {
    expect(normalizeBody('\n\n- a\n  - b\n\n\n', BODY_MAX)).toBe('- a\n  - b');
    expect(normalizeBody('   ', REPLY_MAX)).toBe('');
    expect(normalizeBody('x'.repeat(REPLY_MAX + 1), REPLY_MAX)).toBe('');
  });
});

describe('parseAudience', () => {
  it('always carries admin and lowercases + dedupes emails', () => {
    expect(parseAudience(['staff'], ['A@x.y', 'a@x.y', ' b@x.y '])).toEqual({
      ok: true,
      audience: { roles: ['staff', 'admin'], emails: ['a@x.y', 'b@x.y'] },
    });
  });

  it('rejects unknown roles and non-string emails', () => {
    const bad = (roles: unknown, emails: unknown) => {
      const result = parseAudience(roles, emails);
      return result.ok ? '' : result.error;
    };
    expect(bad(['boss'], [])).toMatch(/audienceRoles/);
    expect(bad(['staff'], [1])).toMatch(/audienceEmails/);
    expect(bad('staff', [])).toMatch(/audienceRoles/);
  });
});

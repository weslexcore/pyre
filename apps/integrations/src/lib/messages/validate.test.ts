import { describe, expect, it } from 'vitest';
import {
  BODY_MAX,
  draftBody,
  draftTitle,
  normalizeBody,
  normalizeTitle,
  parseAudience,
  parseSharedWith,
  REPLY_MAX,
  sendProblem,
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
  it('keeps the roles as given and lowercases + dedupes emails', () => {
    expect(parseAudience(['staff'], ['A@x.y', 'a@x.y', ' b@x.y '])).toEqual({
      ok: true,
      audience: { roles: ['staff'], emails: ['a@x.y', 'b@x.y'] },
    });
    expect(parseAudience([], ['a@x.y'])).toEqual({
      ok: true,
      audience: { roles: [], emails: ['a@x.y'] },
    });
  });

  it('needs at least one role or person', () => {
    expect(parseAudience([], [])).toEqual({ ok: false, error: 'Pick at least one role or person' });
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

describe('parseSharedWith', () => {
  it('lowercases, dedupes, and leaves the author out; empty is a private draft', () => {
    expect(parseSharedWith(['A@x.test', 'a@x.test', 'me@x.test'], 'me@x.test')).toEqual({
      ok: true,
      emails: ['a@x.test'],
    });
    expect(parseSharedWith([], 'me@x.test')).toEqual({ ok: true, emails: [] });
  });

  it('refuses anything but a list of strings', () => {
    expect(parseSharedWith('a@x.test', 'me@x.test').ok).toBe(false);
    expect(parseSharedWith([1], 'me@x.test').ok).toBe(false);
  });
});

describe('drafts may be incomplete', () => {
  it('keeps a blank title or body, and refuses only bad types and overlong text', () => {
    expect(draftTitle('  ')).toBe('');
    expect(draftTitle(' Weekly ')).toBe('Weekly');
    expect(draftTitle('x'.repeat(TITLE_MAX + 1))).toBeNull();
    expect(draftTitle(undefined)).toBeNull();
    expect(draftBody('\n\nhello\n  ')).toBe('hello');
    expect(draftBody('')).toBe('');
    expect(draftBody('x'.repeat(BODY_MAX + 1))).toBeNull();
  });

  it('lets a draft have no audience yet', () => {
    expect(parseAudience([], [], { allowEmpty: true })).toEqual({
      ok: true,
      audience: { roles: [], emails: [] },
    });
  });

  it('names what is missing before a message can go out', () => {
    const ready = { title: 'T', body_md: 'B', audience_roles: ['staff'], audience_emails: [] };
    expect(sendProblem(ready)).toBeNull();
    expect(sendProblem({ ...ready, title: ' ' })).toMatch(/title/);
    expect(sendProblem({ ...ready, body_md: '' })).toMatch(/Write/);
    expect(sendProblem({ ...ready, audience_roles: [] })).toMatch(/role or person/);
  });
});
